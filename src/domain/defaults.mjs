/** Nonpersonal product defaults. Source notes, locations and identity are private configuration. */
export const PRAYER_SECTIONS = Object.freeze([
  { id: 'thanksgiving', title: 'Thanksgiving and Adoration', context: 'Reverence' },
  { id: 'repentance', title: 'Repentance' },
  { id: 'daily-others', title: 'Daily others' },
  { id: 'daily-bread', title: 'Daily bread', context: 'Holy Spirit Empowerment' },
  { id: 'regular-others', title: 'Regular others' },
  { id: 'spontaneous-others', title: 'Spontaneous Others' }
].map(Object.freeze));

export const DEVOTIONAL_PROMPTS = Object.freeze([
  'What does this passage say?',
  'What did this passage mean to its original audience?',
  'What does this passage tell us about God?',
  'What does this passage tell us about man?',
  'What does this passage demand of me?',
  'How does this passage change the way I relate to people?',
  'How does this passage prompt me to pray?'
]);

export function mealPlanning({ meals = [], groceries = [], availableCookingMinutes = null }) {
  return { meals, groceries: groceries.filter(item => !item.completed && !item.checked && !item.archived), preparationMinutes: meals.reduce((sum, meal) => sum + Math.max(0, Number(meal.preparationMinutes) || 0), 0), availableCookingMinutes, noAutomaticNutritionRestriction: true, message: meals.length ? null : 'Add a meal or recipe with its actual preparation time.' };
}

export function prayerCards({ notes = [], date, dayOfWeek }) {
  return PRAYER_SECTIONS.map(section => ({ ...section, notes: notes.filter(note => {
    const weekdays = note.weekdays ?? (Number.isInteger(note.weekday) ? [note.weekday] : null);
    return note.section === section.id && !note.archived && (!Array.isArray(weekdays) || !weekdays.length || weekdays.includes(dayOfWeek));
  }).map(note => ({ ...note, staleReviewOnly: Boolean(note.reviewAfter && note.reviewAfter < date) })) }));
}
