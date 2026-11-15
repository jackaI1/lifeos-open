<script setup lang="ts">
import {onMounted} from 'vue';
import WeekSchedule from './components/WeekSchedule.vue';
import {useWeekSchedule} from './composables/useWeekSchedule.ts';

const props = defineProps<{fetchImpl?: typeof fetch}>();
const {state, load} = useWeekSchedule({fetchImpl: props.fetchImpl});
onMounted(load);
</script>

<template>
  <main>
    <h1>LifeOS week</h1>
    <p v-if="state.status === 'loading'" role="status">Loading the week…</p>
    <div v-else-if="state.status === 'offline' || state.status === 'error'" role="alert">
      <p>{{ state.message }}</p>
      <button type="button" @click="load">Try again</button>
    </div>
    <WeekSchedule v-else :days="state.days" :time-zone="state.timeZone" />
  </main>
</template>
