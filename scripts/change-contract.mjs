// The pure, provider-independent rules for a controlled RLDR change.
export const CONTROLLED_TYPES = Object.freeze([
  'INIT', 'FEAT', 'FIX', 'SEC', 'API', 'A11Y', 'I18N', 'AI', 'DB',
  'OPS', 'TEST', 'DOCS', 'REFACTOR', 'PERF', 'BUILD', 'REVERT', 'CHORE',
]);

export const REQUIRED_BODY_FIELDS = Object.freeze([
  'Change', 'Reason', 'Impact', 'Risk', 'Controls', 'Validation',
  'Evidence', 'Source', 'Release',
]);

export const REQUIRED_PLAN_FIELDS = Object.freeze([
  'Dependency', 'Why', 'Scope', 'Non-goals', 'Acceptance', 'Tests', 'Validation', 'Documentation', 'Authorities',
]);

// Tasks through RLDR-007 merged straight into main. Later tasks squash into the open release/rNNN branch, and
// main changes only by a release PR that rebase-merges one commit per task.
export const LAST_DIRECT_TASK = 7;

const titlePattern = /^\[RLDR-(\d{3,})\] \[([A-Z][A-Z0-9]*)\] (\S[^\r\n]*)$/;
const releaseBranchPattern = /^release\/r(\d{3,})$/;
const shaPattern = /^[0-9a-f]{40}$/;
const runUrlPattern = /^https:\/\/github\.com\/Wizard-Gang\/RenderLab\/actions\/runs\/\d+(?:\/job\/\d+)?$/;
const branchPattern = /^rldr-(\d{3,})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const taskPattern = /^### RLDR-(\d{3,}) — \[([A-Z][A-Z0-9]*)\] (\S[^\r\n]*)$/gm;

const id = (number) => `RLDR-${String(number).padStart(3, '0')}`;
const normalizeBody = (value) => value.replaceAll('\r\n', '\n').replace(/\n+$/, '');
const releaseId = (number) => `r${String(number).padStart(3, '0')}`;
const sameList = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
  && expected.every((value, index) => actual[index] === value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseTitle(subject) {
  const match = titlePattern.exec(subject);
  if (!match || match[1] !== String(Number(match[1])).padStart(3, '0')
    || !CONTROLLED_TYPES.includes(match[2]) || /\[[A-Z][A-Z0-9]*\]/.test(match[3])) return null;
  return { id: id(Number(match[1])), number: Number(match[1]), type: match[2], summary: match[3] };
}

export function parseBranch(branch) {
  const match = branchPattern.exec(branch);
  return match && match[1] === String(Number(match[1])).padStart(3, '0')
    ? { id: id(Number(match[1])), number: Number(match[1]) } : null;
}

export function validateBody(body, label = 'commit') {
  const failures = [];
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const positions = new Map();
  for (const field of REQUIRED_BODY_FIELDS) {
    const matches = lines.flatMap((line, index) => line === `${field}:` ? [index] : []);
    if (matches.length !== 1) failures.push(`${label}: expected exactly one ${field}: field`);
    else positions.set(field, matches[0]);
  }
  let previous = -1;
  for (const [index, field] of REQUIRED_BODY_FIELDS.entries()) {
    const position = positions.get(field);
    if (position === undefined) continue;
    if (position <= previous) failures.push(`${label}: ${field}: is out of order`);
    previous = position;
    const next = REQUIRED_BODY_FIELDS.slice(index + 1)
      .map((name) => positions.get(name))
      .find((candidate) => candidate !== undefined && candidate > position) ?? lines.length;
    if (!lines.slice(position + 1, next).some((line) => line.trim())) {
      failures.push(`${label}: ${field}: has no value`);
    }
  }
  const riskPosition = positions.get('Risk');
  if (riskPosition !== undefined && !/^(Low|Medium|High)$/.test(lines[riskPosition + 1]?.trim() ?? '')) {
    failures.push(`${label}: Risk: must start with Low, Medium, or High`);
  }
  return failures;
}

export function validateHistory(records) {
  const failures = [];
  let lastId = 0;
  if (records.length === 0) failures.push('controlled history is empty');
  records.forEach((record, index) => {
    const label = record.sha || `commit ${index + 1}`;
    const expectedParents = index === 0 ? 0 : 1;
    if (record.parents.length !== expectedParents || (index > 0 && record.parents[0] !== records[index - 1].sha)) {
      failures.push(`${label}: controlled main must be a single first-parent chain without merge commits`);
    }
    const title = parseTitle(record.subject);
    if (!title) {
      failures.push(`${label}: invalid controlled title`);
      return;
    }
    if (title.number !== lastId + 1) failures.push(`${label}: expected ${id(lastId + 1)}, found ${title.id}`);
    // Advance on a bad number so later failures describe the actual sequence.
    lastId = title.number;
    failures.push(...validateBody(record.body, title.id));
  });
  return { failures, lastId };
}

export function validatePlan(markdown, nextId) {
  if (markdown === null || markdown === undefined) {
    return { failures: ['permanent implementation_plan.md is missing'], tasks: [] };
  }
  const failures = [];
  if (!markdown.startsWith('# Implementation plan\n\n## Open tasks\n')) {
    failures.push('implementation_plan.md must retain the common permanent queue heading');
  }
  const headings = [...markdown.matchAll(/^### .+$/gm)];
  const tasks = [...markdown.matchAll(taskPattern)].map((match) => ({
    id: `RLDR-${match[1]}`, number: Number(match[1]), type: match[2], summary: match[3],
    start: match.index, end: match.index + match[0].length,
  }));
  if (!tasks.length && !markdown.includes('The queue is empty. Select no implementation task.')) {
    failures.push('empty implementation_plan.md must instruct the next change to fill the queue');
  }
  if (headings.length !== tasks.length) failures.push('every ### heading must be an RLDR task');
  if (/^#{1,6}\s+(?:Done|Completed|History|Retrospective|Release notes)\b/im.test(markdown)) {
    failures.push('active implementation_plan.md cannot retain completed or historical sections');
  }
  tasks.forEach((task, index) => {
    const expected = nextId + index;
    if (task.number !== expected) failures.push(`${task.id}: expected ${id(expected)} as task ${index + 1}`);
    if (task.id !== id(task.number)) failures.push(`${task.id}: use canonical numeric padding ${id(task.number)}`);
    if (!CONTROLLED_TYPES.includes(task.type)) failures.push(`${task.id}: invalid primary type ${task.type}`);
    const section = markdown.slice(task.end, tasks[index + 1]?.start ?? markdown.length);
    for (const field of REQUIRED_PLAN_FIELDS) {
      if (!new RegExp(`^(?:- )?${field}:\\s*\\S`, 'm').test(section)) failures.push(`${task.id}: missing nonempty ${field} field`);
    }
    if (/^\s*- (?:Status|Merged|Completed|PR|Merge SHA):/im.test(section)) {
      failures.push(`${task.id}: completed-task metadata belongs in Git/GitHub`);
    }
  });
  return { failures, tasks: tasks.map(({ id: taskId, number, type, summary }) => ({ id: taskId, number, type, summary })) };
}

export function parseReleaseBranch(ref) {
  const match = releaseBranchPattern.exec(ref ?? '');
  return match && match[1] === String(Number(match[1])).padStart(3, '0') && Number(match[1]) > 0
    ? { id: releaseId(Number(match[1])), number: Number(match[1]) } : null;
}

/** config/release.json names the open release: `{ id: "r001", branch: "release/r001", tasks: ["RLDR-008", ...] }`. */
export function validateReleaseConfig(config, label = 'config/release.json') {
  if (!isObject(config)) return [`${label} must be an {id, branch, tasks} object`];
  const failures = [];
  if (Object.keys(config).sort().join() !== 'branch,id,tasks') failures.push(`${label} must hold only id, branch and tasks`);
  if (parseReleaseBranch(config.branch)?.id !== config.id) failures.push(`${label}: branch must be release/${config.id} for id ${config.id}`);
  const tasks = Array.isArray(config.tasks) ? config.tasks : [];
  if (!tasks.length) failures.push(`${label}: tasks must list the release's RLDR IDs`);
  tasks.forEach((task, index) => {
    const number = Number(String(task).slice(5));
    if (task !== id(number) || (index > 0 && number !== Number(tasks[index - 1].slice(5)) + 1)) {
      failures.push(`${label}: tasks must be consecutive canonical RLDR IDs`);
    }
  });
  return [...new Set(failures)];
}

/** A docs/releases.json entry proves main's tree after a release equals the tree its release PR tested. */
export function validateReleaseEntry(entry, release, { history, treeOf }) {
  const label = `docs/releases.json ${release.id}`;
  if (!isObject(entry)) return [`${label}: entry is missing`];
  const failures = [];
  if (Object.keys(entry).sort().join() !== 'ci,id,mainHead,pr,tasks,testedHead') {
    failures.push(`${label} must hold only id, pr, testedHead, ci, mainHead and tasks`);
  }
  if (entry.id !== release.id) failures.push(`${label}: id must be ${release.id}`);
  if (!sameList(entry.tasks, release.tasks)) failures.push(`${label}: tasks must be ${release.tasks.join(', ')}`);
  if (!Number.isInteger(entry.pr) || entry.pr < 1) failures.push(`${label}: pr must be the release PR number`);
  if (entry.ci?.conclusion !== 'success' || !runUrlPattern.test(entry.ci?.url ?? '')) {
    failures.push(`${label}: ci must be the release PR's successful verify run {conclusion, url}`);
  }
  for (const field of ['testedHead', 'mainHead']) {
    if (!shaPattern.test(entry[field] ?? '')) failures.push(`${label}: ${field} must be a full commit SHA`);
  }
  if (failures.length) return failures;
  const main = history.find((record) => record.sha === entry.mainHead);
  if (parseTitle(main?.subject ?? '')?.id !== release.tasks.at(-1)) {
    failures.push(`${label}: mainHead must be the ${release.tasks.at(-1)} commit on main`);
  }
  const testedTree = treeOf(entry.testedHead);
  if (!testedTree) failures.push(`${label}: tested head ${entry.testedHead} is not in this checkout; fetch refs/pull/${entry.pr}/head`);
  else if (testedTree !== treeOf(entry.mainHead)) failures.push(`${label}: mainHead tree must equal the tested head tree`);
  return failures;
}

function validateReleaseTask(context, title, failures) {
  const head = context.headRelease;
  const configFailures = validateReleaseConfig(head, 'head config/release.json');
  failures.push(...configFailures);
  if (configFailures.length || !title) return;
  if (head.branch !== context.targetBranch) failures.push(`PR must target the config/release.json branch ${head.branch}`);
  const base = isObject(context.baseRelease) ? context.baseRelease : null;
  const continuing = base?.id === head.id;
  const tasks = continuing ? [...base.tasks, title.id] : [title.id];
  if (!sameList(head.tasks, tasks)) failures.push(`config/release.json tasks must be ${tasks.join(', ')}`);
  const baseLedger = context.baseReleases ?? [];
  const headLedger = context.headReleases;
  if (!Array.isArray(baseLedger) || !Array.isArray(headLedger)) {
    failures.push('docs/releases.json must be a JSON array');
    return;
  }
  const appends = !continuing && base !== null;
  if (headLedger.length !== baseLedger.length + (appends ? 1 : 0)
      || baseLedger.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(headLedger[index]))) {
    failures.push(appends
      ? `docs/releases.json must keep its entries and append ${base.id}`
      : 'docs/releases.json changes only in the first task of a release that follows another');
  }
  if (continuing) return;
  const next = releaseId((base ? parseReleaseBranch(base.branch)?.number ?? 0 : 0) + 1);
  if (head.id !== next) failures.push(`the first task of a release must open ${next}`);
  if (appends && headLedger.length === baseLedger.length + 1) {
    failures.push(...validateReleaseEntry(headLedger.at(-1), base, { history: context.baseHistory, treeOf: context.treeOf }));
  }
}

/** The release PR, release/rNNN into main: exactly one task commit per config/release.json task, oldest first. */
export function validateReleasePullRequest(context) {
  const failures = [];
  const release = parseReleaseBranch(context.branch);
  const head = context.headRelease;
  const configFailures = validateReleaseConfig(head, 'head config/release.json');
  failures.push(...configFailures);
  const tasks = configFailures.length ? [] : head.tasks;
  if (!configFailures.length) {
    if (head.branch !== context.branch) failures.push(`release PR head must be the config/release.json branch ${head.branch}`);
    const expectedTitle = `[RELEASE] ${release.id}: ${tasks[0]}${tasks.length > 1 ? `..${tasks.at(-1)}` : ''}`;
    if (context.title !== expectedTitle) failures.push(`release PR title must be ${expectedTitle}`);
  }
  const base = validateHistory(context.baseHistory);
  const history = validateHistory([...context.baseHistory, ...context.rangeRecords]);
  failures.push(...history.failures);
  if (context.mergeBaseSha !== context.baseSha || context.rangeRecords[0]?.parents[0] !== context.baseSha) {
    failures.push('release branch must be current with main');
  }
  if (context.commitRangeCount !== context.rangeRecords.length) failures.push('release range must be one first-parent chain');
  const ids = context.rangeRecords.map((record) => parseTitle(record.subject)?.id ?? record.sha);
  if (!sameList(ids, tasks)) {
    failures.push(`release commits must be one per listed task (${tasks.join(', ')}); found ${ids.join(', ') || 'none'}`);
  }
  failures.push(...validatePlan(context.basePlan, base.lastId + 1).failures.map((failure) => `base plan: ${failure}`));
  failures.push(...validatePlan(context.headPlan, history.lastId + 1).failures.map((failure) => `head plan: ${failure}`));
  return { failures, nextId: release.id };
}

export function validatePullRequest(context) {
  if (context.targetBranch === 'main' && parseReleaseBranch(context.branch)) return validateReleasePullRequest(context);
  const failures = [];
  const release = parseReleaseBranch(context.targetBranch);
  if (context.targetBranch !== 'main' && !release) failures.push('controlled PR must target main or a release/rNNN branch');
  const baseHistory = validateHistory(context.baseHistory);
  failures.push(...baseHistory.failures);
  const expected = baseHistory.lastId + 1;
  const title = parseTitle(context.title);
  const branch = parseBranch(context.branch);
  if (!title) failures.push('PR title must be [RLDR-###] [TYPE] Imperative summary');
  if (!branch) failures.push('branch must be rldr-###-imperative-summary');
  if (context.title !== context.head.subject) failures.push('PR title must exactly equal the head commit subject');
  if (typeof context.prBody !== 'string') failures.push('PR body must contain the controlled commit body');
  else if (normalizeBody(context.prBody) !== normalizeBody(context.head.body)) {
    failures.push('PR body must exactly equal the head commit body (ignoring line endings and trailing newlines)');
  }
  if (title && branch && title.id !== branch.id) failures.push(`branch ${branch.id} does not match PR ${title.id}`);
  if (title && title.number !== expected) failures.push(`PR must use next sequential ${id(expected)}`);
  if (title && !release && title.number > LAST_DIRECT_TASK) {
    failures.push(`${title.id} must target the open release/rNNN branch; main changes only by release PR`);
  }
  if (context.mergeBaseSha !== context.baseSha || context.head.parents.length !== 1 || context.head.parents[0] !== context.baseSha) {
    failures.push('PR head must be a direct child of the current base commit');
  }
  if (context.commitRangeCount !== 1) failures.push(`PR range must contain one controlled commit; found ${context.commitRangeCount}`);
  failures.push(...validateBody(context.head.body, title?.id ?? 'head commit'));

  const basePlan = validatePlan(context.basePlan, expected);
  failures.push(...basePlan.failures.map((failure) => `base plan: ${failure}`));
  const headPlan = validatePlan(context.headPlan, expected + 1);
  failures.push(...headPlan.failures.map((failure) => `head plan: ${failure}`));
  if (basePlan.tasks.length === 0) {
    if (headPlan.tasks.length === 0) {
      failures.push('a change from an empty queue must publish a future-task plan');
    }
  } else {
    const first = basePlan.tasks[0];
    if (first && title && first.type !== title.type) failures.push(`${first.id}: first task type must match PR type`);
    const remaining = basePlan.tasks.slice(1);
    if (remaining.length === 0 && headPlan.tasks.length !== 0) {
      failures.push('delivering the final task must leave the queue empty');
    }
    if (remaining.length > 0 && headPlan.tasks.length === 0) failures.push('delivering a task must preserve remaining future tasks');
    remaining.forEach((task, index) => {
      if (headPlan.tasks[index]?.id !== task.id) failures.push(`${task.id}: future task was removed or reordered`);
    });
  }
  if (release) validateReleaseTask(context, title, failures);
  return { failures, nextId: id(expected) };
}
