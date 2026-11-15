import {el, button, field, select, modal, toast, busy} from './ui.js';
import {peekSharedItem, clearSharedItem, sharedText, sharedTitle, studyNoteData} from './share-target.js';

// Shows the newest item shared from another phone app as a study-note form.
// The item stays in the inbox until the note is saved or discarded, so closing the
// form without choosing leaves it for the next launch.
export async function offerSharedItem(ctx) {
  const item = await peekSharedItem();
  if (!item) return;
  const courses = ctx.records('course');
  if (!courses.length) {
    toast('A shared item is waiting. Create a course first, then open LifeOS again.');
    return;
  }
  const course = select('Course', courses.map(c => ({value: c.id, label: c.data.title || c.data.code || c.id})), courses[0].id);
  const title = field('Title', {value: sharedTitle(item), maxLength: 200});
  const text = field('Text', {multiline: true, value: sharedText(item), maxLength: 6000});
  const save = button('Save as study note', async event => busy(event.currentTarget, async () => {
    let data;
    try {
      data = studyNoteData({courseId: course.input.value, title: title.input.value, text: text.input.value});
    } catch (error) {
      toast(error.message);
      return;
    }
    const result = await ctx.outbox.submit('/api/learning-notes', {id: crypto.randomUUID(), version: 0, data});
    await clearSharedItem();
    dialog.close();
    toast(result?.pending ? result.reason : 'Saved to your study notes.');
  }));
  const discard = button('Discard', async () => {
    await clearSharedItem();
    dialog.close();
    toast('Shared item discarded.');
  }, 'quiet');
  const form = el('div', {class: 'form-stack'}, course.node, title.node, text.node, el('div', {class: 'actions'}, save, discard));
  const dialog = modal('Shared from another app', form);
}
