import {select as d3select} from 'd3-selection';
import {axisBottom, axisLeft, axisTop} from 'd3-axis';
import {buildWeek, weekGeometry, addDays, weekStart} from './model.mjs';
import {el, replace, button, heading, getDisplayTimeZone} from '@shell/ui.js';

const dayLabel = day => new Intl.DateTimeFormat('en-CA', {weekday: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(day + 'T12:00Z'));
const hours = minutes => `${+(minutes / 60).toFixed(1)} h`;
const detailText = d => `${dayLabel(d.day)}${d.label ? ', ' + d.label : ''}: ${d.count ?? d.tasks.length} deadlines, ${hours(d.taskMinutes ?? d.minutes)} remaining${d.calendarMinutes !== undefined ? ', ' + hours(d.calendarMinutes) + ' calendar time' : ''}${d.unknown ? ', ' + d.unknown + ' missing estimates' : ''}`;

export function mount(root, ctx) {
  const current = weekStart(ctx.state.bootstrap.today?.date || ctx.date());
  let selected = current;
  const charts = el('div', {class: 'workload-charts'}), range = el('p', {class: 'workload-range', 'aria-live': 'polite'});
  const previous = button('Previous week', () => move(-7), 'quiet'), next = button('Next week', () => move(7), 'quiet');
  const controls = el('div', {class: 'actions workload-controls'}, previous, button('This week', () => {selected = current; render();}, 'quiet'), next);
  replace(root, heading('Week workload', null, el('a', {href: '#school', class: 'source-link'}, 'Back to Academics')), el('div', {class: 'workload-view'}, el('p', {}, 'Find deadline clusters before choosing when to study.'), controls, range, el('p',{class:'workload-help'},'Hover or Tab for details. Click or press Enter to list tasks. On a small screen, scroll each chart sideways to see the full week.'), charts));
  function move(offset) { selected = addDays(selected, offset); render(); }
  function render() {
    const model = buildWeek({tasks: ctx.records('task'), events: ctx.records('calendar-event'), courses: ctx.records('course'), date: selected, timeZone: getDisplayTimeZone()});
    const geometry = weekGeometry(model);
    range.textContent = `${model.start} to ${model.days.at(-1)} · ${model.timeZone}`;
    const tooltip = el('p', {id: 'workload-tooltip', class: 'workload-tooltip', role: 'tooltip', hidden: true});
    const details = el('section', {class: 'workload-details', 'aria-label': 'Selected deadlines', 'aria-live': 'polite'}, el('p', {}, 'Select a day or heat-map cell to open its tasks.'));
    function taskList(items) {
      return items.length ? el('ul', {}, items.map(t => el('li', {}, el('a', {href: '#school?brief=' + encodeURIComponent(t.id)}, t.title || 'Untitled task'), ` (${t.minutes === null ? 'estimate unknown' : hours(t.minutes)})`))) : el('p', {}, 'No outstanding tasks in this selection.');
    }
    function showDetails(d) { replace(details, el('h3', {}, detailText(d)), taskList(d.tasks)); }
    function interactive(marks) {
      return marks.attr('tabindex', 0).attr('role', 'button').attr('aria-label', detailText).attr('aria-describedby', 'workload-tooltip')
        .on('pointerenter focus', function(event, d) {tooltip.hidden = false; tooltip.textContent = detailText(d); d3select(this).classed('is-highlighted', true);})
        .on('pointerleave blur', function() {tooltip.hidden = true; d3select(this).classed('is-highlighted', false);})
        .on('click', (_, d) => showDetails(d)).on('keydown', (event, d) => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); showDetails(d);} if (event.key === 'Escape') tooltip.hidden = true;});
    }
    function chart(title, description, height, label) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${geometry.width} ${height}`); svg.setAttribute('aria-label', label); svg.setAttribute('role', 'group');
      const scroll = el('div', {class: 'workload-scroll', tabindex: 0, role: 'region', 'aria-label': label + ', scroll horizontally on small screens'}, svg);
      const section = el('section', {class: 'workload-chart'}, el('h2', {}, title), el('p', {class: 'muted'}, description), scroll);
      return {section, svg: d3select(svg)};
    }
    const timeline = chart('Weekly workload timeline', 'Hours of saved calendar time plus remaining work due each day. This is a load comparison, not a study schedule. Overlapping calendar time is counted once.', 340, 'Weekly workload timeline');
    timeline.section.append(el('p', {class: 'workload-legend'}, el('span', {class: 'calendar-key'}, 'Solid: calendar time'), el('span', {class: 'tasks-key'}, 'Hatched: work due')));
    const defs = timeline.svg.append('defs');
    defs.append('pattern').attr('id', 'workload-hatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6).append('path').attr('d', 'M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2').attr('stroke', 'var(--ink)').attr('stroke-width', 1);
    timeline.svg.append('g').attr('class', 'workload-axis').attr('transform', `translate(0,${geometry.bottom})`).call(axisBottom(geometry.x).ticks(5).tickFormat(h => h + ' h'));
    timeline.svg.append('g').attr('class', 'workload-axis').attr('transform', `translate(${geometry.left},0)`).call(axisLeft(geometry.y).tickFormat(dayLabel).tickSize(0));
    const bars = interactive(timeline.svg.append('g').selectAll('g').data(geometry.bars, d => d.day).join('g').attr('class', 'workload-mark workload-day'));
    bars.append('rect').attr('class', 'workload-hit').attr('x', geometry.left).attr('y', d => d.y).attr('width', geometry.right - geometry.left).attr('height', d => d.height);
    bars.append('rect').attr('class', 'calendar-bar').attr('x', d => d.x).attr('y', d => d.y).attr('width', d => d.calendarWidth).attr('height', d => d.height);
    bars.append('rect').attr('class', 'task-bar').attr('x', d => d.taskX).attr('y', d => d.y).attr('width', d => d.taskWidth).attr('height', d => d.height);
    bars.append('rect').attr('fill', 'url(#workload-hatch)').attr('pointer-events', 'none').attr('x', d => d.taskX).attr('y', d => d.y).attr('width', d => d.taskWidth).attr('height', d => d.height);
    const heat = chart('Deadline heat map', 'Each cell shows the number of outstanding tasks due for a course. Darker to brighter blue means more deadlines. Numbers keep the count readable without colour.', geometry.heatHeight, 'Deadline heat map');
    heat.svg.append('g').attr('class', 'workload-axis').attr('transform', 'translate(0,32)').call(axisTop(geometry.hx).tickFormat(dayLabel).tickSize(0));
    heat.svg.append('g').attr('class', 'workload-axis').attr('transform', `translate(${geometry.left},0)`).call(axisLeft(geometry.hy).tickFormat(id => model.rows.find(r => r.id === id).label).tickSize(0)).selectAll('.tick text').text(id => {const label = model.rows.find(r => r.id === id).label; return label.length > 17 ? label.slice(0, 16) + '…' : label;}).append('title').text(id => model.rows.find(r => r.id === id).label);
    const cells = interactive(heat.svg.append('g').selectAll('g').data(geometry.cells, d => d.key).join('g').attr('class', 'workload-mark workload-cell'));
    cells.append('rect').attr('x', d => d.x).attr('y', d => d.y).attr('width', d => d.width).attr('height', d => d.height).attr('fill', d => d.fill);
    cells.append('text').attr('x', d => d.x + d.width / 2).attr('y', d => d.y + d.height / 2).attr('dy', '.35em').attr('text-anchor', 'middle').attr('fill', 'var(--ink)').text(d => d.count);
    const warnings = el('div', {class: 'workload-warnings'}, el('p', {}, `${model.unknownDates.length} tasks have unknown dates. ${model.overdue.length} tasks are overdue before this week.`), el('p', {}, `${model.notices} date-only calendar notices and ${model.invalidEvents} invalid calendar times are excluded from hours. Estimates may overlap saved study blocks; totals are not a measure of free time.`));
    if (model.unknownDates.length) warnings.append(el('details', {}, el('summary', {}, 'Review unknown dates'), taskList(model.unknownDates)));
    if (model.overdue.length) warnings.append(el('details', {}, el('summary', {}, 'Review earlier deadlines'), taskList(model.overdue)));
    replace(charts, timeline.section, tooltip, heat.section, details, warnings);
    if (!model.rows.length) heat.section.append(el('p', {}, 'No outstanding coursework. Add a task in Academics to see its deadline here.'));
  }
  render();
  return {update: render, destroy() {replace(charts);}};
}
