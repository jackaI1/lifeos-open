<script setup lang="ts">
import type {LoadStatus, WeekDeadline, WeekSchedule} from '../types';

defineProps<{
  week: WeekSchedule | null;
  status: LoadStatus;
  message: string | null;
}>();
const emit = defineEmits<{retry: []}>();

function timeLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone, hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(value));
}
function dayLabel(date: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone, weekday: 'long', month: 'short', day: 'numeric'}).format(new Date(`${date}T12:00:00Z`));
}
function deadlineText(item: WeekDeadline): string {
  return item.overdue ? `${item.title} (overdue, due ${item.day})` : `${item.title} due ${item.day}`;
}
</script>

<template>
  <section aria-labelledby="week-heading">
    <h1 id="week-heading">Week schedule</h1>
    <p v-if="status === 'loading'" role="status">Loading the week…</p>
    <p v-else-if="status === 'offline'" role="status" class="notice">{{ message }}</p>
    <div v-else-if="status === 'error'" role="alert" class="notice">
      <p>{{ message }}</p>
      <button type="button" @click="emit('retry')">Try again</button>
    </div>
    <template v-if="week && (status === 'ready' || status === 'offline')">
      <p>Starting {{ dayLabel(week.start, week.timeZone) }}. Times are shown in {{ week.timeZone }}.</p>
      <ul v-if="week.overdue.length" aria-label="Overdue">
        <li v-for="item in week.overdue" :key="item.id">{{ deadlineText(item) }}</li>
      </ul>
      <article v-for="day in week.days" :key="day.date" class="day" :aria-label="dayLabel(day.date, week.timeZone)">
        <h2>{{ dayLabel(day.date, week.timeZone) }}</h2>
        <ol v-if="day.events.length">
          <li v-for="event in day.events" :key="event.id">
            <time :datetime="event.start">{{ timeLabel(event.start, week.timeZone) }}</time>
            {{ event.title }}<span v-if="event.location"> ({{ event.location }})</span>
          </li>
        </ol>
        <p v-else>No events.</p>
        <ul v-if="day.deadlines.length" aria-label="Deadlines">
          <li v-for="item in day.deadlines" :key="item.id">{{ deadlineText(item) }}</li>
        </ul>
      </article>
      <p v-if="week.withoutDate">{{ week.withoutDate }} open task(s) have no date yet.</p>
    </template>
  </section>
</template>

<style scoped>
.notice { border-left: 4px solid currentColor; padding-inline-start: 0.75rem; }
.day { border-top: 1px solid #ccc; padding-block: 0.5rem; }
</style>
