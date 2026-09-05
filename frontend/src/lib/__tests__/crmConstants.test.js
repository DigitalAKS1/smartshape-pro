import { STAGES, settableStages } from '../crmConstants';

const ids = (list) => list.map(s => s.id);

test('every stage is still defined, so existing leads render truthfully', () => {
  // Deleting a retired stage would make leads sitting in it display as "New".
  expect(ids(STAGES)).toContain('retention');
  expect(ids(STAGES)).toContain('resell');
});

test('the retired stages are marked as such', () => {
  const retired = STAGES.filter(s => s.deprecated).map(s => s.id);
  expect(retired).toEqual(['retention', 'resell']);
});

test('a picker offers only the live stages', () => {
  expect(ids(settableStages())).toEqual(
    ['new', 'contacted', 'demo', 'quoted', 'negotiation', 'won', 'lost']);
});

test('a deal already in a retired stage keeps that option, so its dropdown is not blank', () => {
  expect(ids(settableStages('retention'))).toContain('retention');
  expect(ids(settableStages('retention'))).not.toContain('resell');
});

test('you can move out of a retired stage, because the live ones are all offered', () => {
  const opts = ids(settableStages('retention'));
  ['new', 'contacted', 'demo', 'quoted', 'negotiation', 'won', 'lost']
    .forEach(id => expect(opts).toContain(id));
});

test('a live stage does not drag the retired ones back into a picker', () => {
  expect(ids(settableStages('demo'))).not.toContain('retention');
});
