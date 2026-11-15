<script setup lang="ts">
import type {WeekDay} from '../week.ts';

const props = defineProps<{days: WeekDay[]; timeZone: string}>();

function clock(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {hour: 'numeric', minute: '2-digit', timeZone: props.timeZone}).format(new Date(value));
}
function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-CA', {weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(`${date}T12:00:00Z`));
}
</script>

<template>
  <ol class="week" aria-label="This week">
    <li v-for="day in props.days" :key="day.date" :class="{today: day.isToday}">
      <h2>
        <time :datetime="day.date">{{ dayLabel(day.date) }}</time>
        <span v-if="day.isToday"> (today)</span>
      </h2>
      <p v-if="day.events.length === 0 && day.deadlines.length === 0">Nothing planned.</p>
      <ul v-if="day.events.length" aria-label="Events">
        <li v-for="event in day.events" :key="event.id">
          <time :datetime="event.start">{{ clock(event.start) }}</time>–<time :datetime="event.end">{{ clock(event.end) }}</time>
          {{ event.title }}<span v-if="event.location">, {{ event.location }}</span>
        </li>
      </ul>
      <ul v-if="day.deadlines.length" aria-label="Deadlines">
        <li v-for="item in day.deadlines" :key="item.id">
          Due: {{ item.title }}<span v-if="item.overdue"> (overdue)</span>
        </li>
      </ul>
    </li>
  </ol>
</template>
