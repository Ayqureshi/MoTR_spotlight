#!/usr/bin/env python3
"""
Merge EyeLink (WebLink) gaze data with MoTR Spotlight mouse data.

Needs only Python 3 (no pandas). Two commands:

  1) See what WebLink wrote into the EDF (run this first on a pilot session):
       python merge_weblink.py inspect  session.asc

  2) Align the clocks and merge:
       python merge_weblink.py merge  session.asc  RESULTS  [--out merged.csv]

     RESULTS is the participant's results ZIP (motr_results_*.zip) or an unzipped
     folder / Results\\...\\complete folder containing raw_position_samples.csv,
     sync_events.csv and ias_passage_NN.ias.

Convert the EDF to ASC first with SR Research's edf2asc (e.g. `edf2asc session.edf`).

How the clocks are aligned
--------------------------
At each passage start / question the app changes its URL to ...#motr_pNN_start /
#motr_pNN_question and logs the PC wall-clock time (sync_events.csv). WebLink logs URL
changes as EDF messages with tracker timestamps. Matching marker names gives pairs
(PC time, tracker time); a straight-line fit (offset + clock drift) maps every mouse
sample onto the tracker clock. If WebLink does not log the markers, pass a known
offset with --offset-ms (tracker_ms = pc_epoch_ms + offset).
"""
import argparse
import bisect
import csv
import io
import os
import re
import statistics
import sys
import zipfile

MARKER_RE = re.compile(r"motr_p(\d+)_(start|question)", re.IGNORECASE)


# ---------------------------------------------------------------- ASC parsing
def parse_asc(path):
    """Return (samples, messages). samples: list of (t, x, y, pupil); messages: list of (t, text)."""
    samples, messages = [], []
    binocular = False
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line:
                continue
            c = line[0]
            if c.isdigit():
                f = line.split()
                try:
                    t = int(float(f[0]))
                except ValueError:
                    continue
                eyes = [(f[1], f[2], f[3])]
                if binocular and len(f) >= 7:
                    eyes.append((f[4], f[5], f[6]))
                xs, ys, ps = [], [], []
                for ex, ey, ep in eyes:
                    try:
                        xs.append(float(ex))
                        ys.append(float(ey))
                        ps.append(float(ep))
                    except ValueError:
                        pass  # '.' = missing (blink / track loss)
                if xs:
                    samples.append((t, sum(xs) / len(xs), sum(ys) / len(ys), sum(ps) / len(ps)))
                else:
                    samples.append((t, None, None, None))
            elif line.startswith("MSG"):
                m = re.match(r"MSG\s+(\d+)\s+(-?\d+\s+)?(.*)", line.rstrip("\r\n"))
                if m:
                    t = int(m.group(1))
                    if m.group(2):  # "MSG time offset text": event happened at time - offset
                        t -= int(m.group(2))
                    messages.append((t, m.group(3)))
            elif line.startswith("SAMPLES") or line.startswith("START"):
                binocular = "LEFT" in line and "RIGHT" in line
    return samples, messages


# ---------------------------------------------------------- results loading
class Results:
    """Read files from a results ZIP or folder by base name."""

    def __init__(self, path):
        self.path = path
        self.files = {}
        if os.path.isfile(path) and path.lower().endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    base = os.path.basename(name)
                    if base:
                        self.files[base] = z.read(name).decode("utf-8-sig", errors="replace")
        elif os.path.isdir(path):
            for base in os.listdir(path):
                full = os.path.join(path, base)
                if os.path.isfile(full):
                    with open(full, "r", encoding="utf-8-sig", errors="replace") as fh:
                        self.files[base] = fh.read()
        else:
            sys.exit(f"Results not found (need a .zip or folder): {path}")

    def csv(self, name):
        if name not in self.files:
            sys.exit(f"{name} is missing from {self.path}. Was the session run with the sync-enabled build in offline mode?")
        return list(csv.DictReader(io.StringIO(self.files[name])))

    def ias(self, padded=True):
        """{passage_number: [(word_index, left, top, right, bottom, label), ...]}"""
        out = {}
        for name, text in self.files.items():
            m = re.match(r"ias_passage_(\d+)\.ias$", name)
            if not m:
                continue
            boxes = []
            for line in text.splitlines():
                f = line.split("\t")
                if len(f) >= 7 and f[0] == "RECTANGLE":
                    boxes.append((int(f[1]), float(f[2]), float(f[3]), float(f[4]), float(f[5]), f[6]))
            out[int(m.group(1))] = pad_boxes(boxes) if padded else boxes
        return out


def pad_boxes(boxes):
    """Stretch word boxes vertically to fill the gaps between text lines (standard for reading
    studies), so gaze/mouse between lines is assigned to the nearest line. The app exports boxes
    exactly as tall as the glyphs; with double spacing half of the screen height is gap."""
    rows = sorted({(b[2], b[4]) for b in boxes})
    if not rows:
        return boxes
    gaps = [b[0] - a[1] for a, b in zip(rows, rows[1:]) if b[0] > a[1]]
    edge = (statistics.median(gaps) / 2) if gaps else (rows[0][1] - rows[0][0]) / 2
    new_rows = {}
    for i, (top, bottom) in enumerate(rows):
        above = (top - rows[i - 1][1]) / 2 if i > 0 else edge
        below = (rows[i + 1][0] - bottom) / 2 if i + 1 < len(rows) else edge
        new_rows[(top, bottom)] = (top - max(0, above), bottom + max(0, below))
    out = []
    for idx, left, top, right, bottom, label in boxes:
        new_top, new_bottom = new_rows[(top, bottom)]
        out.append((idx, left, new_top, right, new_bottom, label))
    return out


def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------- clock alignment
MIN_DRIFT_SPAN_MS = 5 * 60 * 1000


def fit_clock(pairs):
    """pairs: [(pc_ms, tracker_ms)]. Returns (slope, intercept). Slope captures clock drift.

    Drift (tens of ppm) is only measurable over minutes; over a short span the URL-logging
    jitter dominates, so fall back to a constant (median) offset.
    """
    span = max(p for p, _ in pairs) - min(p for p, _ in pairs)
    if len(pairs) < 3 or span < MIN_DRIFT_SPAN_MS:
        offset = statistics.median(t - p for p, t in pairs)
        return 1.0, offset
    # Fit around the first marker so the huge epoch values don't swamp the arithmetic.
    base = pairs[0][0]
    pairs = [(p - base, t) for p, t in pairs]
    xs = [p for p, _ in pairs]
    ys = [t for _, t in pairs]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in pairs) / sxx
    return slope, (my - slope * mx) - slope * base


def align(messages, sync_rows, offset_ms=None, report=print):
    if offset_ms is not None:
        report(f"Using manual offset: tracker_ms = pc_ms + {offset_ms}")
        return lambda pc: pc + offset_ms

    tracker_by_marker = {}
    for t, text in messages:
        m = MARKER_RE.search(text)
        if m:
            key = f"motr_p{int(m.group(1)):02d}_{m.group(2).lower()}"
            tracker_by_marker.setdefault(key, t)  # first time WebLink saw this URL

    pairs, names = [], []
    for row in sync_rows:
        marker = row.get("marker", "")
        pc = num(row.get("epoch_time_ms"))
        if marker in tracker_by_marker and pc is not None:
            pairs.append((pc, tracker_by_marker[marker]))
            names.append(marker)

    if not pairs:
        sys.exit(
            "No #motr_pNN_... markers found in the ASC messages.\n"
            "Run `python merge_weblink.py inspect session.asc` to see what WebLink logs, and check the\n"
            "session used the sync-enabled build (?offline=1). Otherwise pass --offset-ms."
        )

    slope, intercept = fit_clock(pairs)
    residuals = [t - (slope * p + intercept) for p, t in pairs]
    report(f"Matched {len(pairs)} markers between WebLink and the app.")
    if slope == 1.0:
        report(f"Clock map: tracker_ms = pc_epoch_ms + {intercept:.1f}  (constant offset; markers span < 5 min, drift not fitted)")
    else:
        report(f"Clock map: tracker_ms = {slope:.9f} * pc_epoch_ms + {intercept:.1f}")
        report(f"Drift: {(slope - 1) * 1e6:+.1f} ppm ({(slope - 1) * 3600e3:+.1f} ms per hour)")
    report("Residuals (ms) per marker - large values mean WebLink logged that URL late:")
    for name, r in zip(names, residuals):
        report(f"  {name:24s} {r:+8.1f}")
    spread = max(abs(r) for r in residuals)
    report(f"Max |residual|: {spread:.1f} ms" + ("   <-- check alignment (over 50 ms)" if spread > 50 else ""))
    return lambda pc: slope * pc + intercept


MOUSE_MSG_RE = re.compile(r"_MousePosition_ (-?\d+) (-?\d+)")


def refine_with_mouse(to_tracker, messages, mouse_rows, report=print, search_ms=300):
    """WebLink logs the mouse (screen px, tracker clock) every ~17 ms. Find the time shift that
    makes the app's mouse trace match WebLink's best; this removes WebLink's delay in logging
    the URL markers (about 15 ms in the 2026-10-07 pilot). Returns (to_tracker, shift_ms)."""
    wl = []
    for t, text in messages:
        m = MOUSE_MSG_RE.match(text)
        if m and int(m.group(1)) >= 0:
            wl.append((t, int(m.group(1)), int(m.group(2))))
    app = []
    for r in mouse_rows:
        pc, x, y = num(r.get("epoch_time_ms")), num(r.get("mouse_screen_x_px")), num(r.get("mouse_screen_y_px"))
        if pc is not None and x is not None and y is not None:
            app.append((to_tracker(pc), x, y))
    if len(wl) < 50 or len(app) < 50:
        report("Mouse-trace check: skipped (WebLink mouse log or app mouse samples missing).")
        return to_tracker, 0.0
    wl_t = [w[0] for w in wl]

    def mean_dist(shift):
        total = n = 0
        for t, x, y in app:
            i = bisect.bisect_right(wl_t, t + shift) - 1
            if i >= 0:
                total += ((wl[i][1] - x) ** 2 + (wl[i][2] - y) ** 2) ** 0.5
                n += 1
        return total / n if n else float("inf")

    coarse = min(range(-search_ms, search_ms + 1, 5), key=mean_dist)
    best = min(range(coarse - 5, coarse + 6), key=mean_dist)
    d0, d_best = mean_dist(0), mean_dist(best)
    report(f"Mouse-trace check ({len(app)} app samples vs {len(wl)} WebLink positions):")
    report(f"  mean distance {d0:.1f} px with marker alignment, {d_best:.1f} px after shifting {best:+d} ms")
    if d_best > 25 or best in (-search_ms, search_ms):
        report("  no clear match - keeping the marker alignment (check the screen/zoom setup)")
        return to_tracker, 0.0
    report(f"  applied: all app times shifted {best:+d} ms (WebLink's URL-logging delay)")
    return (lambda pc, f=to_tracker, s=best: f(pc) + s), float(best)


# ---------------------------------------------------------------- commands
def cmd_inspect(args):
    samples, messages = parse_asc(args.asc)
    print(f"{args.asc}: {len(samples)} gaze samples, {len(messages)} messages")
    if samples:
        print(f"Tracker time range: {samples[0][0]} - {samples[-1][0]} ms")
    markers = [(t, x) for t, x in messages if MARKER_RE.search(x)]
    print(f"\nMoTR markers (#motr_pNN_...): {len(markers)}")
    for t, x in markers[:20]:
        print(f"  {t}  {x[:120]}")
    if not markers:
        print("  none found - see the sample messages below for how WebLink logs URL changes.")
    print("\nMost common message types:")
    counts = {}
    for _, x in messages:
        key = " ".join(x.split()[:2])[:60]
        counts[key] = counts.get(key, 0) + 1
    for key, n in sorted(counts.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  {n:6d}  {key}")
    url_like = [(t, x) for t, x in messages if "http" in x.lower() or "url" in x.lower()][:10]
    if url_like:
        print("\nMessages mentioning URLs:")
        for t, x in url_like:
            print(f"  {t}  {x[:150]}")


def cmd_merge(args):
    report_lines = []

    def report(line):
        print(line)
        report_lines.append(line)

    samples, messages = parse_asc(args.asc)
    results = Results(args.results)
    sync_rows = results.csv("sync_events.csv")
    mouse_rows = results.csv("raw_position_samples.csv")
    ias = results.ias(padded=not args.no_ia_padding)
    to_tracker = align(messages, sync_rows, args.offset_ms, report)
    if not args.no_mouse_refine:
        to_tracker, _ = refine_with_mouse(to_tracker, messages, mouse_rows, report)

    # Passage windows on the tracker clock.
    starts, ends = {}, {}
    for row in sync_rows:
        p = int(float(row["trial_index"]))
        pc = num(row["epoch_time_ms"])
        if pc is None:
            continue
        if row["event"] == "PASSAGE_START":
            starts.setdefault(p, to_tracker(pc))
        elif row["event"] == "PASSAGE_END":
            ends[p] = to_tracker(pc)
    windows = sorted((starts[p], ends.get(p, starts[p] + 10 * 60 * 1000), p) for p in starts)

    # Mouse samples on the tracker clock.
    mouse = []
    for r in mouse_rows:
        pc = num(r.get("epoch_time_ms"))
        if pc is None:
            continue
        mouse.append((to_tracker(pc), r))
    mouse.sort(key=lambda m: m[0])
    mouse_times = [m[0] for m in mouse]
    if not mouse:
        sys.exit("raw_position_samples.csv has no epoch_time_ms values - session was recorded with an older build.")

    def passage_at(t):
        for start, end, p in windows:
            if start <= t <= end:
                return p
        return None

    def word_at(p, x, y):
        if p is None or x is None:
            return "", ""
        for idx, left, top, right, bottom, label in ias.get(p, []):
            if left <= x <= right and top <= y <= bottom:
                return idx, label
        return "", ""

    columns = [
        "tracker_time_ms", "passage", "ItemId", "gaze_x_px", "gaze_y_px", "pupil",
        "gaze_word_index", "gaze_word",
        "mouse_time_tracker_ms", "mouse_lag_ms", "mouse_screen_x_px", "mouse_screen_y_px",
        "mouse_word_index", "mouse_word", "gaze_mouse_distance_px",
    ]
    written = 0
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(columns)
        for t, gx, gy, pupil in samples:
            p = passage_at(t)
            if p is None and not args.all:
                continue
            i = bisect.bisect_left(mouse_times, t)
            best = None
            for j in (i - 1, i):
                if 0 <= j < len(mouse) and (best is None or abs(mouse[j][0] - t) < abs(best[0] - t)):
                    best = mouse[j]
            mrow, mt = None, ""
            if best is not None and abs(best[0] - t) <= args.tolerance_ms:
                mt, mrow = best
            mx = num(mrow.get("mouse_screen_x_px")) if mrow else None
            my = num(mrow.get("mouse_screen_y_px")) if mrow else None
            gw_idx, gw = word_at(p, gx, gy)
            dist = ""
            if gx is not None and mx is not None:
                dist = round(((gx - mx) ** 2 + (gy - my) ** 2) ** 0.5, 1)
            w.writerow([
                t, p if p is not None else "", mrow.get("ItemId", "") if mrow else "",
                "" if gx is None else round(gx, 1), "" if gy is None else round(gy, 1),
                "" if pupil is None else round(pupil, 1),
                gw_idx, gw,
                "" if mt == "" else round(mt, 1), "" if mt == "" else round(t - mt, 1),
                "" if mx is None else int(mx), "" if my is None else int(my),
                mrow.get("WordIndex", "") if mrow else "", mrow.get("Word", "") if mrow else "",
                dist,
            ])
            written += 1
    report(f"\nWrote {written} rows -> {args.out}")
    report(f"Passages: {len(windows)} | mouse samples: {len(mouse)} | .ias files: {len(ias)}")
    with open(os.path.splitext(args.out)[0] + "_alignment_report.txt", "w", encoding="utf-8") as fh:
        fh.write("\n".join(report_lines) + "\n")


def cmd_pad_ias(args):
    results = Results(args.results)
    out_dir = args.out_dir or (args.results if os.path.isdir(args.results) else os.path.dirname(os.path.abspath(args.results)))
    os.makedirs(out_dir, exist_ok=True)
    for p, boxes in sorted(results.ias(padded=True).items()):
        name = os.path.join(out_dir, f"ias_passage_{p:02d}_padded.ias")
        with open(name, "w", newline="\r\n", encoding="utf-8") as fh:
            for idx, left, top, right, bottom, label in boxes:
                fh.write(f"RECTANGLE\t{idx}\t{int(left)}\t{int(round(top))}\t{int(right)}\t{int(round(bottom))}\t{label}\n")
        print(f"wrote {name}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    p_inspect = sub.add_parser("inspect", help="list what WebLink logged in an ASC file")
    p_inspect.add_argument("asc")
    p_merge = sub.add_parser("merge", help="align clocks and merge gaze + mouse")
    p_merge.add_argument("asc")
    p_merge.add_argument("results", help="results ZIP or folder")
    p_merge.add_argument("--out", default="merged_gaze_mouse.csv")
    p_merge.add_argument("--offset-ms", type=float, default=None, help="manual tracker_ms - pc_epoch_ms")
    p_merge.add_argument("--tolerance-ms", type=float, default=60.0,
                         help="max gap to nearest mouse sample (mouse is sampled every 50 ms)")
    p_merge.add_argument("--all", action="store_true", help="keep gaze samples outside passages")
    p_merge.add_argument("--no-ia-padding", action="store_true",
                         help="use the word boxes exactly as exported (glyph height only)")
    p_merge.add_argument("--no-mouse-refine", action="store_true",
                         help="skip the WebLink mouse-trace fine alignment")
    p_pad = sub.add_parser("pad-ias", help="write ias_passage_NN_padded.ias (lines filled) for Data Viewer")
    p_pad.add_argument("results", help="results ZIP or folder")
    p_pad.add_argument("--out-dir", default=None)
    args = ap.parse_args()
    {"inspect": cmd_inspect, "merge": cmd_merge, "pad-ias": cmd_pad_ias}[args.command](args)


if __name__ == "__main__":
    main()
