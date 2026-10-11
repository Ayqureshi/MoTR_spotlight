import '@motr-shared/polyfills.js';
import Vue from 'vue';
import VueKonva from 'vue-konva';
import VueMagpie from 'magpie-base';
import App from './App.vue';
import DemographicsPreviewApp from '@motr-shared/components/DemographicsPreviewApp.vue';
import {
  isDemographicsPreviewMode,
  isReadingPreviewMode,
} from '@motr-shared/previewMode.js';
import magpieConfig from './magpie.config.js';

Vue.config.productionTip = false;

// Load Konva components
Vue.use(VueKonva, { prefix: 'Canvas' });

// Load magpie components
Vue.use(VueMagpie, magpieConfig);

const readingPreview = isReadingPreviewMode();
const demographicsPreview = isDemographicsPreviewMode();

// Mount App directly for reading preview so spotlight DOM matches the live study.
new Vue({
  render(h) {
    if (readingPreview) return h(App, { props: { readingPreview: true } });
    if (demographicsPreview) return h(DemographicsPreviewApp);
    return h(App);
  },
}).$mount('#app');
