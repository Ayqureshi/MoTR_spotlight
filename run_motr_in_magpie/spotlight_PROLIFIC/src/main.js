import '@motr-shared/polyfills.js';
import Vue from 'vue';
import VueKonva from 'vue-konva';
import VueMagpie from 'magpie-base';
import App from './App.vue';
import DemographicsPreviewApp from '@motr-shared/components/DemographicsPreviewApp.vue';
import { isDemographicsPreviewMode } from '@motr-shared/previewMode.js';
import magpieConfig from './magpie.config.js';

Vue.config.productionTip = false;

// Load Konva components
Vue.use(VueKonva, { prefix: 'Canvas' });

// Load magpie components
Vue.use(VueMagpie, magpieConfig);

const RootComponent = isDemographicsPreviewMode() ? DemographicsPreviewApp : App;

// start app
new Vue({
  render: (h) => h(RootComponent)
}).$mount('#app');
