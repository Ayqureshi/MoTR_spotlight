<!-- Window is fixed, 102px, pointer cursor, gradual blurry effect on surrounding words. -->
<!--  Comprehension questions appear afterwards in the same slide -->
<!-- Hover-to-reveal: unblur around the mouse and record hover duration and position relative to word. -->

<template>
  <div class="motr-root">
    <div v-if="!stimuliReady" class="instructions" style="padding: 2rem; text-align: center;">
      <p>Loading experiment…</p>
    </div>
    <Experiment v-else title="Mouse tracking for Reading" translate="no">

    <Screen :title="'Welcome'" class="instructions" :validations="{
        SubjectID: {
          minLength: $magpie.v.minLength(2)
        }
      }">
        <ConsentPROLIFIC @proceed="recordProlificAndProceed" />
        </Screen>

    <Screen title="Demographics" class="instructions" key="demographics-onestop">
      <DemographicsOneStopQuestionnaire @complete="$magpie.saveAndNextScreen()" />
    </Screen>

    <Screen title="General English" class="instructions" key="cambridge-intro">
      <div style="width: 40em; margin: auto; text-align: left;">
        <p>
          You will now complete a short multiple-choice English test ({{ cambridgeQuestions.length }} items).
          After the test you will continue to the reading part of the study.
        </p>
        <p style="text-align: center; margin-top: 2rem;">
          <button type="button" @click="$magpie.saveAndNextScreen()">Begin test</button>
        </p>
      </div>
    </Screen>

    <Screen
      v-for="(page, pidx) in cambridgePages"
      :key="'cambridge-page-' + pidx"
      :title="'Page ' + (pidx + 1) + ' / ' + cambridgePages.length"
      class="instructions"
    >
      <div style="width: 40em; margin: auto; text-align: left;">
        <div
          v-for="item in page"
          :key="'cambridge-q-' + item.globalIndex"
          style="margin-bottom: 1.75em;"
        >
          <p><strong>{{ item.globalIndex + 1 }}.</strong> {{ item.question.question }}</p>
          <template v-for="(opt, oi) in item.question.options">
            <label :key="'cambridge-opt-' + item.globalIndex + '-' + oi" style="display: block; margin: 0.35em 0;">
              <input type="radio" :value="opt" v-model="cambridgeSelected[item.globalIndex]" />
              {{ opt }}
            </label>
          </template>
        </div>
        <p style="text-align: center; margin-top: 2rem;">
          <button type="button" :disabled="!cambridgePageComplete(page)" @click="submitCambridgePage(page, pidx)">
            Next
          </button>
        </p>
      </div>
    </Screen>

    <InstructionScreen :title="'Instruction'">
<!-- 
      <p>Please use the "Fullscreen Mode" for the duration of the experiment:
        <a href="javascript:void(0)" @click="turnOnFullScreen">Fullscreen Mode</a>
      </p>
 -->
      <p>In this study, you will read short texts and answer questions about them. However, unlike in normal reading, the texts will be blurred. <strong>Move your mouse over the text to reveal it with the spotlight;</strong> the revealed area follows your mouse. Take as much time to read the text as you need in order to understand it. When you are done reading, answer the question on the next page and click "next" to move on. Between each text, you will need to move your mouse back into the rectangle outline to start the next paragraph.</p>
    </InstructionScreen>

    <template v-for="(trial, i) of trials">
      <ReadingStartGateScreen :key="'gate-' + i" :trial-index="i + 1" />
      <Screen :key="'trial-' + i" class="main_screen" :progress="i / trials.length">
        <Slide>
          <form>
            <input type="hidden" class="item_id" :value="trial.item_id">
            <input type="hidden" class="experiment_id" :value="trial.experiment_id">
            <input type="hidden" class="condition_id" :value="trial.condition_id">
            <input type="hidden" class="trial_index" :value="i + 1">
            <input v-if="trial.onestop_file" type="hidden" class="onestop_file" :value="trial.onestop_file">
            <input v-if="trial.onestop_level" type="hidden" class="onestop_level" :value="trial.onestop_level">
            <input v-if="trial.onestop_paragraph_index != null" type="hidden" class="onestop_paragraph_index" :value="trial.onestop_paragraph_index">
            <input v-if="trial.onestop_question_slot != null" type="hidden" class="onestop_question_slot" :value="trial.onestop_question_slot">
            <input v-if="trial.onestop_article_number" type="hidden" class="onestop_article_number" :value="trial.onestop_article_number">
            <input v-if="trial.onestop_article_title" type="hidden" class="onestop_article_title" :value="trial.onestop_article_title">
            <input v-if="trial.onestop_article_order != null" type="hidden" class="onestop_article_order" :value="trial.onestop_article_order">
            <input v-if="trial.onestop_block_order != null" type="hidden" class="onestop_block_order" :value="trial.onestop_block_order">
            <input v-if="trial.onestop_block_level" type="hidden" class="onestop_block_level" :value="trial.onestop_block_level">
            <input v-if="trial.onestop_article_selection_mode" type="hidden" class="onestop_article_selection_mode" :value="trial.onestop_article_selection_mode">
            <input v-if="trial.onestop_manual_article_numbers" type="hidden" class="onestop_manual_article_numbers" :value="trial.onestop_manual_article_numbers">
          </form>
          <div class="oval-cursor"></div>
          <template v-if="showFirstDiv">
            <div class="readingText" @mousemove="onRevealHover" @mouseleave="changeBack">
              <template v-for="(word, index) of trial.text.split(' ')">
                <span :key="index" :data-index="index + 1">
                  {{ word }}
                </span>
              </template>
            </div>
            <div class="blurry-layer" style="opacity: 0.3; filter: blur(3.5px); transition: all 0.3s linear 0s;">
              {{ trial.text }}
            </div>
            <div class="reading-text-spacer" aria-hidden="true">{{ trial.text }}</div>
          </template>

          <div v-if="!showFirstDiv" class="trial-comprehension-panel">
            <form>
              <div class="trial-comprehension-question">{{ (trial.question || '').replace(/ ?["]+/g, '') }}</div>
              <template v-for="(word, index) of trial.response_options">
                <label :key="'opt_'+index" class="trial-response-option">
                  <input :id="'opt_'+index" type="radio" :value="word" name="opt" v-model="$magpie.measurements.response" />
                  {{ word }}
                </label>
              </template>
            </form>
          </div>

          <div class="trial-actions">
            <button v-if="showFirstDiv" type="button" class="trial-done-btn" @click="toggleDivs" :disabled="!isCursorMoving">
              Done
            </button>
            <button v-if="!showFirstDiv && $magpie.measurements.response" type="button" class="trial-next-btn" @click="submitTrialResponse(trial, i)">
              Next
            </button>
          </div>
        </Slide>
      </Screen>
    </template>
<Screen>
  <p>1. Which input device are you using for this experiment?</p>
    <MultipleChoiceInput
        :response.sync= "$magpie.measurements.device"
        orientation="horizontal"
        :options="['Computer Mouse', 'Computer Trackpad', 'Other']" />
  <br>
  <br>
  <p>2. Which hand are you using during this experiment?</p>
    <MultipleChoiceInput
        :response.sync= "$magpie.measurements.hand"
        orientation="horizontal"
        :options="['Left', 'Right', 'Both']" />
  <button style= "bottom:30%; transform: translate(-50%, -50%)" @click="$magpie.saveAndNextScreen();">Submit</button>
</Screen>

    <ExportReportsScreen
      v-if="!offlineMode"
      :skip-sona-input="true"
      :prolific-completion-url="prolificCompletionUrl"
      :github-results-path="githubResultsPath"
    />
    <OfflineResultsScreen v-if="offlineMode" />
  </Experiment>
  </div>
</template>

<script>
// Practice trials (TSV); main trials from OneStop CSVs; comprehension from OneStop Stimuli .xlsx
import spotlight_practice from '../trials/spotlight_items_practice.tsv';
import _ from 'lodash';
import studyConfig from './studyConfig';
import { buildOneStopTrialLists } from '@motr-shared/buildOneStopTrialLists';
import { loadStimuliRowMap } from '@motr-shared/parseOneStopStimuli';
import { prepareParticipantReadingTrials } from '@motr-shared/readingTrialSetup';
import {
  chunkCambridgeQuestions,
  prepareCambridgeQuestions,
  prepareCambridgeScoring,
  cefrBandForScore,
  isCambridgeAnswerCorrect,
} from '@motr-shared/cambridgeGeneralEnglish';
import ExportReportsScreen from './components/ExportReportsScreen.vue';
import ReadingStartGateScreen from '@motr-shared/components/ReadingStartGateScreen.vue';
import {
  deferReadingTrialSafeguards,
  ensureExperimentStartRecorded,
  initResultsSession,
} from '@motr-shared/resultsSafeguard';
import {
  installRawPositionSampling,
  outOfBoundsWordForIndex,
  uninstallRawPositionSampling,
} from '@motr-shared/motrRawSampling';
import {
  appendOneStopTrialMeta,
  readOneStopTrialMetaFromEl,
} from '@motr-shared/oneStopExportFields';
import DemographicsOneStopQuestionnaire from '@motr-shared/components/DemographicsOneStopQuestionnaire.vue';
import ConsentPROLIFIC from './components/ConsentPROLIFIC.vue';
import OfflineResultsScreen from '@motr-shared/components/OfflineResultsScreen.vue';
import { isOfflineMode, silenceOfflineSocketWarning } from '@motr-shared/previewMode.js';
import { markPassageEvent } from '@motr-shared/syncMarkers.js';

// eslint-disable-next-line import/no-webpack-loader-syntax
const oneStopStimuliXlsx = require('../../OneStop/OneStop Stimuli .xlsx');
// eslint-disable-next-line import/no-webpack-loader-syntax
const cambridgeTestCsv = require('../../OneStop/Cambridge/Cambridge General English Test(Sheet1).csv');
// eslint-disable-next-line import/no-webpack-loader-syntax
const cambridgeScoringCsv = require('../../OneStop/Cambridge/Cambridge scoring(Sheet1).csv');

export default {
  name: 'App',
  components: {
    ExportReportsScreen,
    ReadingStartGateScreen,
    ConsentPROLIFIC,
    DemographicsOneStopQuestionnaire,
    OfflineResultsScreen,
  },
  data() {
    return {
      prolificCompletionUrl: studyConfig.completionUrl,
      githubResultsPath: studyConfig.githubResultsPath,
      stimuliReady: false,
      isCursorMoving: false,
      isClickHeld: false,
      trials: [],
      currentIndex: null,
      showFirstDiv: true,
      mousePosition: {
          x: 0,
          y: 0,
        },
      // Hover dwell state for recording (per word interest area)
      clickStartTime: null,
      clickStartX: null,
      clickStartY: null,
      clickWordIndex: null,
      clickWord: null,
      clickWordRect: null,
      relativeXInWord: null,
      relativeYInWord: null,
      clickLineNumber: null,
      clickPositionInLine: null,
      interestAreasByIndex: {},
      lastItemId: null,
      oneStopRowMap: new Map(),
      oneStopLists: null,
      cambridgeQuestions: [],
      cambridgeScoring: [],
      cambridgeSelected: [],
    };
  },
  async created() {
    let rowMap = new Map();
    try {
      rowMap = await loadStimuliRowMap(oneStopStimuliXlsx);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Could not load OneStop Stimuli workbook; using fallback questions for passages.', e);
    }
    this.oneStopRowMap = rowMap;
    this.oneStopLists = buildOneStopTrialLists();
    const camQ = prepareCambridgeQuestions(cambridgeTestCsv);
    this.cambridgeQuestions = camQ;
    this.cambridgeScoring = prepareCambridgeScoring(cambridgeScoringCsv);
    this.cambridgeSelected = camQ.map(() => null);
    this.stimuliReady = true;
  },
  computed: {
    offlineMode() {
      return isOfflineMode();
    },
    cambridgeComputedScore() {
      if (!this.cambridgeQuestions.length) return 0;
      let n = 0;
      for (let i = 0; i < this.cambridgeQuestions.length; i++) {
        if (isCambridgeAnswerCorrect(this.cambridgeSelected[i], this.cambridgeQuestions[i].correct)) {
          n++;
        }
      }
      return n;
    },
    cambridgeCefrLabel() {
      return cefrBandForScore(this.cambridgeComputedScore, this.cambridgeScoring);
    },
    cambridgePages() {
      return chunkCambridgeQuestions(this.cambridgeQuestions);
    },
  },
  watch: {
    magpie(m) {
      silenceOfflineSocketWarning(m);
    },
    '$magpie.currentScreenIndex'() {
      this.resetTrialView();
      this.$nextTick(() => {
        const meta = this.currentPassageMeta();
        if (meta) markPassageEvent(this, 'PASSAGE_START', meta.index, meta.itemId);
      });
    },
  },
  mounted() {
    ensureExperimentStartRecorded(this);
    installRawPositionSampling(this);
  },
  beforeDestroy() {
    uninstallRawPositionSampling(this);
  },
  methods: {
    getCharSizePx() {
      const span = this.$el.querySelector('.readingText span[data-index]');
      if (span) {
        const rect = span.getBoundingClientRect();
        const width = span.innerHTML.length > 0 ? rect.width / span.innerHTML.length : 10;
        return { width, height: rect.height };
      }
      return { width: 10, height: 20 };
    },
    getLineClosestTo(clientY) {
      const spans = this.$el.querySelectorAll('.readingText span[data-index]');
      if (!spans.length) return null;
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < spans.length; i++) {
        const rect = spans[i].getBoundingClientRect();
        const lineCenter = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(lineCenter - clientY);
        if (dist < bestDist) {
          bestDist = dist;
          best = { lineTop: rect.top, lineBottom: rect.bottom, lineHeight: rect.height };
        }
      }
      return best;
    },
    computeInterestAreas() {
      const spans = this.$el.querySelectorAll('.readingText span[data-index]');
      if (!spans.length) {
        this.interestAreasByIndex = {};
        return;
      }

      const items = [];
      let maxHeight = 0;
      spans.forEach(span => {
        const rect = span.getBoundingClientRect();
        const index = Number(span.getAttribute('data-index'));
        items.push({ index, rect });
        if (rect.height > maxHeight) maxHeight = rect.height;
      });

      // Group spans into lines using a vertical tolerance.
      const tol = 3;
      const byLine = {};
      for (const it of items) {
        const key = Math.round(it.rect.top / tol) * tol;
        if (!byLine[key]) byLine[key] = [];
        byLine[key].push(it);
      }

      const lines = Object.values(byLine)
        .map(line => line.sort((a, b) => a.rect.left - b.rect.left))
        .sort((a, b) => a[0].rect.top - b[0].rect.top);

      const areas = {};

      // Compute vertical boundaries that tile the space between lines:
      // - between lines: use midpoints
      // - before first line / after last line: use half a line-gap.
      const lineBounds = lines.map(lineItems => {
        const tops = lineItems.map(li => li.rect.top);
        const bottoms = lineItems.map(li => li.rect.bottom);
        return {
          top: Math.min(...tops),
          bottom: Math.max(...bottoms)
        };
      });

      const lineVerticals = [];
      if (lineBounds.length === 1) {
        // Single line: fall back to a small margin based on maxHeight.
        const lb = lineBounds[0];
        const top = lb.top - 0.5 * maxHeight;
        const bottom = lb.bottom + 0.5 * maxHeight;
        lineVerticals.push({ top, bottom });
      } else {
        const mids = [];
        for (let i = 0; i < lineBounds.length - 1; i++) {
          mids.push((lineBounds[i].bottom + lineBounds[i + 1].top) / 2);
        }

        for (let k = 0; k < lineBounds.length; k++) {
          let top;
          let bottom;
          if (k === 0) {
            const gap = lineBounds[1].top - lineBounds[0].bottom;
            top = lineBounds[0].top - gap / 2;
            bottom = mids[0];
          } else if (k === lineBounds.length - 1) {
            const gap = lineBounds[k].top - lineBounds[k - 1].bottom;
            top = mids[k - 1];
            bottom = lineBounds[k].bottom + gap / 2;
          } else {
            top = mids[k - 1];
            bottom = mids[k];
          }
          lineVerticals.push({ top, bottom });
        }
      }

      const { width: baseCharWidth } = this.getCharSizePx();
      const charWidth = baseCharWidth && Number.isFinite(baseCharWidth) ? baseCharWidth : 10;

      lines.forEach((lineItems, lineIdx) => {
        const n = lineItems.length;
        if (!n) return;

        const vBounds = lineVerticals[lineIdx];

        for (let i = 0; i < n; i++) {
          const curr = lineItems[i].rect;
          const idx = lineItems[i].index;

          let left;
          let right;

          if (n === 1) {
            // Single word on this line
            left = curr.left - charWidth / 2;
            right = curr.right + charWidth / 2;
          } else if (i === 0) {
            const next = lineItems[i + 1].rect;
            const midNext = (curr.right + next.left) / 2;
            left = curr.left - charWidth / 2;
            right = midNext;
          } else if (i === n - 1) {
            const prev = lineItems[i - 1].rect;
            const midPrev = (prev.right + curr.left) / 2;
            left = midPrev;
            right = curr.right + charWidth / 2;
          } else {
            const prev = lineItems[i - 1].rect;
            const next = lineItems[i + 1].rect;
            left = (prev.right + curr.left) / 2;
            right = (curr.right + next.left) / 2;
          }

          const top = vBounds.top;
          const bottom = vBounds.bottom;

          areas[idx] = {
            left,
            right,
            top,
            bottom,
            lineNumber: lineIdx + 1
          };
        }

        const firstIdx = lineItems[0].index;
        const lineStartX = areas[firstIdx].left;
        lineItems.forEach(it => {
          areas[it.index].lineStartX = lineStartX;
        });
      });

      this.interestAreasByIndex = areas;
    },
    changeBack() {
      if (this.isClickHeld) {
        this.finishClick(performance.now());
      }
      const oval = this.$el.querySelector(".oval-cursor");
      if (oval) {
        oval.classList.remove('grow');
        oval.classList.remove('blank');
        oval.style.width = '0px';
        oval.style.height = '0px';
      }
      this.currentIndex = null;
      this.isClickHeld = false;
    },
    onRevealHover(e) {
      this.isCursorMoving = true;
      const x = e.clientX;
      const y = e.clientY;
      this.mousePosition.x = x;
      this.mousePosition.y = y;
      const now = performance.now();

      const oval = this.$el.querySelector(".oval-cursor");
      if (oval) {
        oval.classList.add('grow');
      }
      const { width: charWidth } = this.getCharSizePx();
      const line = this.getLineClosestTo(y);
      const charsLeft = 4;
      const charsRight = 14;
      const totalChars = charsLeft + charsRight;
      const ovalWidthPx = totalChars * charWidth;
      const ovalHeightPx = line ? line.lineHeight : 20;
      const ovalCenterY = line ? (line.lineTop + line.lineBottom) / 2 : y;
      oval.style.width = `${ovalWidthPx}px`;
      oval.style.height = `${ovalHeightPx}px`;
      oval.style.left = `${x + (charsRight - charsLeft) / 2 * charWidth}px`;
      oval.style.top = `${ovalCenterY}px`;

      // Detect new text (ItemId change) and reset interest areas.
      const itemInput = this.$el.querySelector(".item_id");
      if (itemInput) {
        const itemId = itemInput.value;
        if (this.lastItemId === null || this.lastItemId !== itemId) {
          this.interestAreasByIndex = {};
          this.lastItemId = itemId;
        }
      }

      // Ensure interest areas are computed.
      if (!this.interestAreasByIndex || !Object.keys(this.interestAreasByIndex).length) {
        this.computeInterestAreas();
      }

      let ia = null;
      let iaIndex = null;
      for (const key of Object.keys(this.interestAreasByIndex)) {
        const a = this.interestAreasByIndex[key];
        if (x >= a.left && x <= a.right && y >= a.top && y <= a.bottom) {
          ia = a;
          iaIndex = Number(key);
          break;
        }
      }

      if (ia && iaIndex != null) {
        oval.classList.remove('blank');
        const index = iaIndex;
        const span = this.$el.querySelector(`.readingText span[data-index="${index}"]`);
        const wordText = span ? span.innerHTML : null;

        if (!this.isClickHeld || this.clickWordIndex !== index) {
          if (this.isClickHeld) {
            this.finishClick(now);
          }
          this.isClickHeld = true;
          this.clickStartTime = now;
          this.clickStartX = x;
          this.clickStartY = y;
        }

        this.clickWordIndex = index;
        this.clickWord = wordText;
        this.clickWordRect = { top: ia.top, left: ia.left, bottom: ia.bottom, right: ia.right };

        const width = ia.right - ia.left;
        const height = ia.bottom - ia.top;
        this.relativeXInWord = width > 0 ? (x - ia.left) / width : null;
        this.relativeYInWord = height > 0 ? (y - ia.top) / height : null;

        const { lineNumber, positionInLine } = this.getWordLineAndPositionInLine(index);
        this.clickLineNumber = lineNumber;
        this.clickPositionInLine = positionInLine;
        this.currentIndex = index;
      } else {
        if (this.isClickHeld) {
          this.finishClick(now);
        }
        this.isClickHeld = false;
        oval.classList.add('blank');
        this.clickWordIndex = -1;
        this.clickWord = null;
        this.clickWordRect = null;
        this.relativeXInWord = null;
        this.relativeYInWord = null;
        this.clickLineNumber = null;
        this.clickPositionInLine = null;
        this.currentIndex = -1;
      }
    },
    getWordLineAndPositionInLine(wordIndex) {
      const spans = this.$el.querySelectorAll('.readingText span[data-index]');
      if (!spans.length) return { lineNumber: null, positionInLine: null };
      const items = [];
      for (let i = 0; i < spans.length; i++) {
        const rect = spans[i].getBoundingClientRect();
        const idx = spans[i].getAttribute('data-index');
        items.push({ index: idx, top: rect.top, left: rect.left });
      }
      const tol = 3;
      const byLine = {};
      for (const it of items) {
        const key = Math.round(it.top / tol) * tol;
        if (!byLine[key]) byLine[key] = [];
        byLine[key].push(it);
      }
      const lines = Object.keys(byLine).map(k => byLine[k]).sort((a, b) => a[0].top - b[0].top);
      for (let l = 0; l < lines.length; l++) {
        lines[l].sort((a, b) => a.left - b.left);
        for (let p = 0; p < lines[l].length; p++) {
          if (String(lines[l][p].index) === String(wordIndex)) {
            return { lineNumber: l + 1, positionInLine: p + 1 };
          }
        }
      }
      return { lineNumber: null, positionInLine: null };
    },
    finishClick(endTime) {
      const expEl = this.$el.querySelector(".experiment_id");
      if (!expEl) return;
      const durationMs = this.clickStartTime != null ? endTime - this.clickStartTime : null;
      const subjectId =
        this.$magpie && this.$magpie.measurements && this.$magpie.measurements.SubjectID
          ? this.$magpie.measurements.SubjectID
          : '';
      const trialIndexEl = this.$el.querySelector(".trial_index");
      const presentationOrder = trialIndexEl && trialIndexEl.value !== '' ? parseInt(trialIndexEl.value, 10) : null;
      const spans = this.$el.querySelectorAll('.readingText span[data-index]');
      const totalWordsInItem = spans && spans.length ? spans.length : null;
      const allWords = spans && spans.length ? Array.from(spans).map((s) => s.innerHTML).join(' ') : null;
      const payload = {
        recordType: 'hover_association',
        Experiment: expEl.value,
        Condition: this.$el.querySelector(".condition_id").value,
        ItemId: this.$el.querySelector(".item_id").value,
        presentation_order: presentationOrder,
        Index: this.clickWordIndex !== null && this.clickWordIndex !== -1 ? parseInt(this.clickWordIndex, 10) : this.clickWordIndex,
        Word: outOfBoundsWordForIndex(this.clickWordIndex, this.clickWord),
        mousePositionX: this.clickStartX,
        mousePositionY: this.clickStartY,
        revealMode: 'hover',
        clickDurationMs: durationMs,
        hoverDurationMs: durationMs,
        relativeXInWord: this.relativeXInWord,
        relativeYInWord: this.relativeYInWord,
        totalWordsInItem: totalWordsInItem,
        allWords: allWords,
        SubjectId: subjectId,
        SubjectID: subjectId,
        ProlificId: subjectId,
        ProlificID: subjectId,
      };
      if (this.clickWordRect) {
        payload.wordPositionTop = this.clickWordRect.top;
        payload.wordPositionLeft = this.clickWordRect.left;
        payload.wordPositionBottom = this.clickWordRect.bottom;
        payload.wordPositionRight = this.clickWordRect.right;
      }
      if (this.clickLineNumber != null) payload.line_number = this.clickLineNumber;
      if (this.clickPositionInLine != null) payload.position_in_line = this.clickPositionInLine;
      appendOneStopTrialMeta(payload, readOneStopTrialMetaFromEl(this.$el));
      $magpie.addTrialData(payload);
      this.clickStartTime = null;
      this.clickStartX = null;
      this.clickStartY = null;
      this.clickWordIndex = null;
      this.clickWord = null;
      this.clickWordRect = null;
      this.relativeXInWord = null;
      this.relativeYInWord = null;
      this.clickLineNumber = null;
      this.clickPositionInLine = null;
    },
    toggleDivs() {
      this.showFirstDiv = !this.showFirstDiv;
      this.isCursorMoving = false;
      const meta = this.currentPassageMeta();
      if (meta && !this.showFirstDiv) markPassageEvent(this, 'PASSAGE_QUESTION', meta.index, meta.itemId);
    },
    /** Trial number (1-based) and item of the reading screen currently shown, or null. */
    currentPassageMeta() {
      if (!this.$el || !this.$el.querySelector) return null;
      const indexEl = this.$el.querySelector('.main_screen .trial_index');
      if (!indexEl || indexEl.value === '') return null;
      const itemEl = this.$el.querySelector('.main_screen .item_id');
      return { index: parseInt(indexEl.value, 10), itemId: itemEl ? itemEl.value : '' };
    },
    resetTrialView() {
      this.showFirstDiv = true;
      this.isCursorMoving = false;
      this.isClickHeld = false;
      this.currentIndex = null;
      this.interestAreasByIndex = {};
      this.lastItemId = null;
      this.changeBack();
    },
    getScreenDimensions() {
      return {
        window_inner_width: window.innerWidth,
        window_inner_height: window.innerHeight
      };
    },
    recordProlificAndProceed() {
      this.cambridgeSelected = this.cambridgeQuestions.map(() => null);
      const id = (this.$magpie && this.$magpie.measurements && this.$magpie.measurements.SubjectID) ? String(this.$magpie.measurements.SubjectID).trim() : '';
      this.$magpie.addExpData({
        ParticipantId: id,
        SubjectId: id,
        SubjectID: id,
        ProlificId: id,
        ProlificID: id,
        study_key: studyConfig.studyKey,
      });
      this.$magpie.addTrialData({
        ProlificId: id,
        ProlificID: id,
        SubjectId: id,
        SubjectID: id,
        study_key: studyConfig.studyKey,
        source: 'welcome'
      });
      initResultsSession(this, studyConfig);
      this.$magpie.nextScreen();
    },
    recordResponse(trial) {
      const m = this.$magpie && this.$magpie.measurements ? this.$magpie.measurements : null;
      if (!m || !m.response) return;
      const itemId = trial.item_id != null ? trial.item_id : trial.ItemId;
      const selectedResponse = String(m.response).trim();
      const correctAnswer = trial && trial.response_true != null ? String(trial.response_true).replace(/ ?["]+/g, '').trim() : '';
      const responseCorrect = correctAnswer !== '' ? (selectedResponse === correctAnswer ? '1' : '0') : '';
      this.$magpie.addTrialData({
        ItemId: itemId,
        response: selectedResponse,
        response_correct: responseCorrect
      });
    },
    submitTrialResponse(trial, trialIndex) {
      markPassageEvent(this, 'PASSAGE_END', trialIndex + 1, trial && trial.item_id);
      try {
        this.recordResponse(trial);
      } catch (err) {
        console.warn('recordResponse failed:', err);
      } finally {
        this.$magpie.saveAndNextScreen();
        deferReadingTrialSafeguards(this, trial, trialIndex, studyConfig);
      }
    },
    cambridgePageComplete(page) {
      return page.every((item) => this.cambridgeSelected[item.globalIndex]);
    },
    submitCambridgePage(page, pageIndex) {
      if (!this.cambridgePageComplete(page)) return;
      for (const item of page) {
        const cidx = item.globalIndex;
        const cq = item.question;
        const sel = this.cambridgeSelected[cidx];
        if (!sel) return;
        const ok = isCambridgeAnswerCorrect(sel, cq.correct);
        this.$magpie.addTrialData({
          source: 'cambridge_general_english',
          cambridge_item: cidx + 1,
          cambridge_selected: sel,
          cambridge_correct_answer: cq.correct,
          cambridge_item_correct: ok ? '1' : '0',
        });
      }
      if (pageIndex === this.cambridgePages.length - 1) {
        this.finishCambridgeBlock();
      } else {
        this.$magpie.saveAndNextScreen();
      }
    },
    finishCambridgeBlock() {
      const score = this.cambridgeComputedScore;
      const { trials, metadata } = prepareParticipantReadingTrials({
        score,
        oneStopLists: this.oneStopLists,
        oneStopRowMap: this.oneStopRowMap,
        practiceTrials: spotlight_practice,
        studyConfig,
      });
      this.trials = trials;
      this.$magpie.addTrialData({
        source: 'cambridge_general_english_summary',
        cambridge_score: score,
        cambridge_max: this.cambridgeQuestions.length,
        cambridge_cefr: this.cambridgeCefrLabel,
        study_key: metadata.studyKey,
        onestop_level_pair: metadata.levelPair.join('|'),
        onestop_level_block_order: metadata.levelBlockOrder,
        onestop_level_assignment_rule: metadata.assignmentRule,
        onestop_reading_article_count: metadata.readingArticleCount,
        onestop_reading_trial_count: metadata.readingTrialCount,
        onestop_article_selection_mode: metadata.articleSelectionMode,
        onestop_manual_article_numbers: metadata.manualArticleNumbers,
      });
      this.$nextTick(() => {
        this.$magpie.saveAndNextScreen();
      });
    },
  },
};
</script>


<style>
  .experiment {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .main_screen {
    isolation: isolate;
    position: relative;
    width: 100%;
    height: auto;
    font-size: 18px;
    line-height: 40px;
  }
  .reading-text-spacer {
    visibility: hidden;
    pointer-events: none;
    color: black;
    text-align: left;
    font-weight: 450;
    padding-top: 2%;
    padding-bottom: 2%;
    padding-left: 11%;
    padding-right: 11%;
  }
  .trial-actions {
    padding: 1.25rem 0 0.5rem;
    text-align: center;
  }
  .debugResults{
    width: 100%;
  }
  .readingText {
    position: absolute;
    color: white;
    text-align: left;
    font-weight: 450;
    cursor: pointer;
    padding-top: 2%;
    padding-bottom: 2%;
    padding-left: 11%;
    padding-right: 11%;
    pointer-events: auto;
  }
  button {
    position: absolute;
    bottom: 0;
    left: 50%;
  }
  .trial-actions .trial-done-btn,
  .trial-actions .trial-next-btn {
    position: relative;
    bottom: auto;
    left: auto;
    transform: none;
    z-index: 3;
    display: inline-block;
    margin: 0 auto;
  }
  .trial-comprehension-panel {
    margin-top: 1.25rem;
    padding: 0.75rem 11% 0.25rem;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
  }
  .trial-comprehension-question {
    margin-bottom: 0.75em;
  }
  .trial-response-option {
    display: block;
    margin: 0.35em 0;
    text-align: left;
  }
  .oval-cursor {
    position: fixed;
    z-index: 2;
    width: 0;
    height: 0;
    transform: translate(-50%, -50%);
    background-color: white;
    mix-blend-mode: difference;
    border-radius: 50%;
    pointer-events: none;
    transition: none;
  }
  .oval-cursor.grow {
    border-radius: 50%;
    box-shadow: 30px 0 8px -4px rgba(255, 255, 255, 0.1), -30px 0 8px -4px rgba(255, 255, 255, 0.1);
    background-color: rgba(255, 255, 255, 0.3);
    background-blend-mode: screen;
    pointer-events: none;
    filter: blur(3px);
  }
  .oval-cursor.grow::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 70%;
    height: 70%;
    background-color: white;
    mix-blend-mode: normal;
    border-radius: 50%;
  }
  .blurry-layer {
    position: absolute;
    pointer-events: none;
    color: black;
    text-align: left;
    font-weight: 450;
    padding-top: 2%;
    padding-bottom: 2%;
    padding-left: 11%;
    padding-right: 11%;
  }

  * {
    user-select: none; /* Standard syntax */
    -webkit-user-select: none; /* Safari */
    -moz-user-select: none; /* Firefox */
    -ms-user-select: none; /* Internet Explorer/Edge */
    }
</style>
