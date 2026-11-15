<script setup lang="ts">
import {onMounted} from 'vue';
import WeeklySchedule from './components/WeeklySchedule.vue';
import {useWeekSchedule} from './composables/useWeekSchedule';

const {status, message, week, load} = useWeekSchedule();
onMounted(load);
</script>

<template>
  <main>
    <WeeklySchedule :week="week" :status="status" :message="message" @retry="load" />
    <p class="footer">Fictional demo data from the public LifeOS feed.</p>
  </main>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 0; color: #111; background: #fff; }
main { max-width: 42rem; margin: 0 auto; padding: 1rem; }
.footer { color: #555; font-size: 0.9rem; }
@media (prefers-color-scheme: dark) {
  body { color: #eee; background: #111; }
  .footer { color: #aaa; }
}
</style>
