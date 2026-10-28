import {assert,button,go,reload,saved} from './helpers.mjs';
export default async function({page:p}){
  await go(p,'school');
  const priority=['Compare two feedback models','Systems pre-lab checklist','Sketch the watershed diagram','Map the feedback loop','Read the watershed example','Check the workshop reflection deadline'];
  const deadlines=['Systems pre-lab checklist','Map the feedback loop','Read the watershed example','Sketch the watershed diagram','Compare two feedback models','Check the workshop reflection deadline'];
  const order=()=>p.locator('.hero-action:visible .task-title h3, .task-card .task-title h3').evaluateAll(nodes=>nodes.map(node=>node.firstChild.textContent));
  assert.deepEqual(await order(),priority);
  await p.getByLabel('Sort academic tasks',{exact:true}).selectOption('due');
  assert.deepEqual(await order(),deadlines);
  await reload(p);
  assert.deepEqual(await order(),deadlines);
  await p.getByLabel('Sort academic tasks',{exact:true}).selectOption('priority');
  assert.deepEqual(await order(),priority);
  // Saving less remaining work must reorder the middle of the list too.
  await p.locator('.task-card').filter({hasText:'Sketch the watershed diagram'}).getByRole('button',{name:'Task options',exact:true}).click();
  await button(p,'Edit task').click();
  await p.getByLabel('Estimated minutes',{exact:true}).fill('5');
  await p.getByLabel('Difficulty',{exact:true}).selectOption('1');
  await button(p,'Save task').click();await saved(p);
  // Dialog closure precedes the asynchronous list refresh; wait for the saved
  // values to render before asserting the resulting priority order.
  const edited=p.locator('.task-card').filter({hasText:'Sketch the watershed diagram'});
  await edited.getByText('5 min remaining',{exact:false}).waitFor();
  await edited.getByText('Difficulty 1/5',{exact:false}).waitFor();
  const after=['Compare two feedback models','Systems pre-lab checklist','Map the feedback loop','Read the watershed example','Sketch the watershed diagram','Check the workshop reflection deadline'];
  assert.deepEqual(await order(),after);
  await reload(p);
  assert.deepEqual(await order(),after);
}
