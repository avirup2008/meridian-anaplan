import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBlueprint,
  scanDeterministicFindings,
  summarizeFindingsForSuggestions,
  validateAiSuggestions,
  scoreFindings,
  buildAnalysisSnapshot,
  buildModelIntelligence,
  buildArchitectureClassification,
  buildDependencyGraph,
  isDecorativeModuleName,
} from '../api/analysis-core.js';
import { guardTokens } from '../api/analyze.js';

const blueprint = {
  modelId: 'model-1',
  modules: [
    {
      id: 'm-dat',
      name: 'DAT01 Project Master',
      lineItemCount: 4,
      lineItems: [
        {
          id: 'li-active',
          name: 'Active',
          format: { dataType: 'BOOLEAN' },
          summary: { summaryMethod: 'SUM' },
          appliesTo: [{ name: 'Projects' }],
        },
        {
          id: 'li-calc',
          name: 'Calculated Cost',
          format: 'Number',
          summary: { summaryMethod: 'SUM' },
          appliesTo: [{ name: 'Projects' }],
          formula: 'FIN02 Cost Aggregation.Total Cost',
        },
        {
          id: 'li-rate',
          name: 'Margin %',
          format: { dataType: 'PERCENTAGE' },
          summary: { summaryMethod: 'SUM' },
          appliesTo: [{ name: 'Projects' }],
          formula: 'Revenue / Cost',
        },
        {
          id: 'li-select',
          name: 'Hardcoded Region',
          format: { dataType: 'NUMBER' },
          summary: { summaryMethod: 'NONE' },
          appliesTo: [{ name: 'Projects' }],
          formula: "Sales[SELECT: Regions.'North']",
        },
      ],
    },
    {
      id: 'm-calc',
      name: 'CAL01 Demand Calc',
      lineItemCount: 2,
      lineItems: [
        {
          id: 'li-sum-lookup',
          name: 'Demand by Region',
          format: { dataType: 'NUMBER' },
          summary: { summaryMethod: 'SUM' },
          appliesTo: [{ name: 'Products' }, { name: 'Regions' }],
          formula: 'Demand.Source[SUM: Product Map, LOOKUP: Region Map]',
        },
        {
          id: 'li-deep-if',
          name: 'Nested Status',
          format: { dataType: 'TEXT' },
          summary: { summaryMethod: 'NONE' },
          appliesTo: [{ name: 'Products' }],
          formula: 'IF A THEN "A" ELSE IF B THEN "B" ELSE IF C THEN "C" ELSE IF D THEN "D" ELSE "E"',
        },
      ],
    },
    {
      id: 'm-wide',
      name: 'PLN01 Wide Module',
      lineItemCount: 1,
      lineItems: [
        {
          id: 'li-wide',
          name: 'Wide Input',
          format: 'Number',
          summary: 'SUM',
          appliesTo: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        },
      ],
    },
  ],
};

test('normalizes blueprint into stable modules and line item facts', () => {
  const normalized = normalizeBlueprint(blueprint);

  assert.equal(normalized.modelId, 'model-1');
  assert.equal(normalized.modules.length, 3);
  assert.equal(normalized.modules[0].lineItems[0].formatType, 'BOOLEAN');
  assert.equal(normalized.modules[0].lineItems[0].summaryMethod, 'SUM');
  assert.equal(normalized.modules[0].lineItems[0].dimensionCount, 1);
  assert.equal(normalized.modules[1].lineItems[0].hasSumLookup, true);
  assert.equal(normalized.modules[1].lineItems[1].ifDepth, 4);
  assert.equal(normalized.modules[2].lineItems[0].dimensionCount, 7);
});

test('scans all line items for deterministic Anaplan findings', () => {
  const snapshot = buildAnalysisSnapshot(blueprint);
  const findings = snapshot.findings;
  const ruleIds = findings.map(f => f.ruleId);

  assert(ruleIds.includes('MODULE_DATA_HAS_CALC'));
  assert(ruleIds.includes('BOOLEAN_SUMMARY_INVALID'));
  assert(ruleIds.includes('RATE_SUMMARY_SUM'));
  assert(ruleIds.includes('FORMULA_SUM_LOOKUP'));
  assert(ruleIds.includes('FORMULA_SELECT_HARDCODED'));
  assert(ruleIds.includes('FORMULA_NESTED_IF'));
  assert(ruleIds.includes('MODULE_TOO_MANY_DIMS'));

  const datCalc = findings.find(f => f.ruleId === 'MODULE_DATA_HAS_CALC');
  assert.equal(datCalc.moduleName, 'DAT01 Project Master');
  assert.equal(datCalc.lineItemName, 'Calculated Cost');
  assert.match(datCalc.evidence, /FIN02 Cost Aggregation/);
});

test('refuses to score an empty or fully skipped blueprint as healthy', () => {
  assert.throws(
    () => buildAnalysisSnapshot({
      modelId: 'empty-model',
      modules: [
        { id: 'm1', name: 'FIN01 Empty', lineItemCount: 0, lineItems: [], fetchError: 'Timeout' },
        { id: 'm2', name: 'SYS01 Empty', lineItemCount: 0, lineItems: [], fetchError: 'Timeout' },
      ],
    }),
    /No usable line items/
  );
});

test('excludes decorative Anaplan section separators from analysis and diagrams', () => {
  const separatorBlueprint = {
    modelId: 'separator-model',
    modules: [
      {
        id: 'sep',
        name: '▼▼▼ COMPONENT ALLOCATION ▼▼▼',
        lineItemCount: 1,
        lineItems: [{ id: 'sep-li', name: '▼▼▼', format: 'Text', summary: 'None' }],
      },
      {
        id: 'dat',
        name: 'DAT01 Source Data',
        lineItemCount: 1,
        lineItems: [{ id: 'dat-li', name: 'Value', format: 'Number', summary: 'SUM', appliesTo: ['Products'] }],
      },
      {
        id: 'calc',
        name: 'CAL01 Working Calc',
        lineItemCount: 1,
        lineItems: [{ id: 'calc-li', name: 'Value', format: 'Number', summary: 'SUM', appliesTo: ['Products'], formula: 'DAT01 Source Data.Value' }],
      },
    ],
  };
  const normalized = normalizeBlueprint(separatorBlueprint);
  const graph = buildDependencyGraph(normalized);
  const intelligence = buildModelIntelligence(normalized, scanDeterministicFindings(normalized));

  assert.equal(isDecorativeModuleName('▼▼▼ COMPONENT ALLOCATION ▼▼▼'), true);
  assert.deepEqual(normalized.modules.map(m => m.name), ['DAT01 Source Data', 'CAL01 Working Calc']);
  assert.equal(normalized.excludedModules[0].reason, 'decorative_separator');
  assert(!graph.nodes.some(n => n.moduleName.includes('▼')));
  assert(!intelligence.blastRadius.some(b => b.moduleName.includes('▼')));
  assert.match(intelligence.executiveNarrative, /decorative separators/i);
});

test('aggregates repetitive deterministic findings into prioritised suggestion cards', () => {
  const repeatedBlueprint = {
    modelId: 'repeat-model',
    modules: [
      {
        id: 'sys',
        name: 'SYS01 Flags',
        lineItemCount: 6,
        lineItems: ['Active', 'Closed', 'Locked', 'Manual', 'Ready', 'Valid'].map((name, i) => ({
          id: `flag-${i}`,
          name,
          format: 'Boolean',
          summary: 'ANY',
          appliesTo: ['Projects'],
        })),
      },
    ],
  };
  const findings = scanDeterministicFindings(normalizeBlueprint(repeatedBlueprint));
  const booleanNameFindings = findings.filter(f => f.ruleId === 'BOOLEAN_NAME_WEAK');
  const cards = summarizeFindingsForSuggestions(findings);
  const booleanNameCards = cards.filter(f => f.ruleId === 'BOOLEAN_NAME_WEAK');

  assert.equal(booleanNameFindings.length, 6);
  assert.equal(booleanNameCards.length, 1);
  assert.equal(booleanNameCards[0].affectedCount, 6);
  assert.equal(booleanNameCards[0].affectedModuleCount, 1);
  assert.match(booleanNameCards[0].title, /Boolean line item name lacks verb prefix/i);
  assert.match(booleanNameCards[0].evidence, /Examples: SYS01 Flags: Active; SYS01 Flags: Closed/);
});

test('suggestion summary groups model-wide rule patterns into report-sized buckets', () => {
  const modules = Array.from({ length: 30 }, (_, i) => ({
    id: `m-${i}`,
    name: `SYS${String(i + 1).padStart(2, '0')} Flags`,
    lineItemCount: 4,
    lineItems: Array.from({ length: 4 }, (_, j) => ({
      id: `flag-${i}-${j}`,
      name: `Flag ${j + 1}`,
      format: 'Boolean',
      summary: 'ANY',
      appliesTo: ['Projects'],
    })),
  }));
  const findings = scanDeterministicFindings(normalizeBlueprint({ modelId: 'grouped-model', modules }));
  const cards = summarizeFindingsForSuggestions(findings);
  const booleanNameCard = cards.find(f => f.ruleId === 'BOOLEAN_NAME_WEAK');

  assert(cards.length <= 20);
  assert.equal(booleanNameCard.affectedCount, 120);
  assert.equal(booleanNameCard.affectedModuleCount, 30);
  assert.match(booleanNameCard.moduleName, /30 modules/);
});

test('scores repeated line-item findings as a grouped pattern, not raw card spam', () => {
  const repeatedBlueprint = {
    modelId: 'wide-repeat-model',
    modules: [
      {
        id: 'sys',
        name: 'SYS01 Flags',
        lineItemCount: 50,
        lineItems: Array.from({ length: 50 }, (_, i) => ({
          id: `flag-${i}`,
          name: `Flag ${i + 1}`,
          format: 'Boolean',
          summary: 'ANY',
          appliesTo: ['Projects'],
        })),
      },
    ],
  };
  const normalized = normalizeBlueprint(repeatedBlueprint);
  const findings = scanDeterministicFindings(normalized);
  const rawPenaltyWouldBe = findings.reduce((sum, f) => sum + (f.severity === 'info' ? 1 : f.severity === 'warning' ? 2 : 4), 0);
  const score = scoreFindings(findings, normalized);

  assert.equal(findings.filter(f => f.ruleId === 'BOOLEAN_NAME_WEAK').length, 50);
  assert.equal(rawPenaltyWouldBe, 50);
  assert(score.healthScore > 85);
  assert(score.dimensions.naming > 85);
});

test('calibrates high-volume low-risk findings without collapsing score to critical', () => {
  const modules = Array.from({ length: 60 }, (_, i) => ({
    id: `sys-${i}`,
    name: `SYS${String(i + 1).padStart(2, '0')} Flags`,
    lineItemCount: 20,
    lineItems: Array.from({ length: 20 }, (_, j) => ({
      id: `flag-${i}-${j}`,
      name: `Flag ${j + 1}`,
      format: 'Boolean',
      summary: 'ANY',
      appliesTo: ['Products'],
    })),
  }));
  const normalized = normalizeBlueprint({ modelId: 'large-low-risk', modules });
  const findings = scanDeterministicFindings(normalized);
  const score = scoreFindings(findings, normalized);
  const cards = summarizeFindingsForSuggestions(findings);

  assert.equal(findings.length, 1200);
  assert.equal(cards.length, 1);
  assert(score.healthScore >= 85);
  assert.notEqual(score.healthScore, 5);
});

test('validates AI suggestions against real modules, line items, and formula evidence', () => {
  const normalized = normalizeBlueprint(blueprint);
  const suggestions = validateAiSuggestions(normalized, [
    {
      moduleId: 'm-calc',
      moduleName: 'CAL01 Demand Calc',
      domain: 'Formula',
      triage: 'Fix Now',
      title: 'Split SUM and LOOKUP in Demand by Region',
      lineItemName: 'Demand by Region',
      evidence: 'SUM and LOOKUP',
    },
    {
      moduleId: 'fake-module',
      moduleName: 'Invented Module',
      domain: 'Formula',
      triage: 'Fix Now',
      title: 'Invented problem',
      lineItemName: 'Made Up',
    },
    {
      moduleId: 'm-calc',
      moduleName: 'CAL01 Demand Calc',
      domain: 'Formula',
      triage: 'Fix Now',
      title: 'Pattern not present',
      lineItemName: 'Demand by Region',
      evidence: 'RANK',
    },
  ]);

  assert.equal(suggestions.valid.length, 1);
  assert.equal(suggestions.rejected.length, 2);
  assert.equal(suggestions.valid[0].lineItemName, 'Demand by Region');
});

test('scores findings deterministically by severity and domain', () => {
  const normalized = normalizeBlueprint(blueprint);
  const findings = scanDeterministicFindings(normalized);
  const score = scoreFindings(findings, normalized);

  assert(score.healthScore < 80);
  assert.equal(score.verdict, 'Needs Work');
  assert(score.dimensions.formulas < 100);
  assert(score.dimensions.dataHygiene < 100);
  assert(score.dimensions.architecture < 100);
});

test('rejects prompts that exceed the token budget before model calls', async () => {
  const client = {
    messages: {
      async countTokens() {
        return { input_tokens: 180001 };
      },
    },
  };

  await assert.rejects(
    () => guardTokens(client, 'test-model', [{ role: 'user', content: 'large prompt' }]),
    /Prompt exceeds token budget/
  );
});

test('builds graph intelligence with blast radius and remediation order', () => {
  const graphBlueprint = {
    modelId: 'graph-model',
    modules: [
      {
        id: 'dat',
        name: 'DAT01 Project Master',
        lineItemCount: 1,
        lineItems: [
          { id: 'dat-cost', name: 'Contract Value', format: 'Number', summary: 'SUM', appliesTo: ['Projects'] },
        ],
      },
      {
        id: 'fin',
        name: 'FIN01 Cost Calc',
        lineItemCount: 1,
        lineItems: [
          {
            id: 'fin-cost',
            name: 'Project Cost',
            format: 'Number',
            summary: 'SUM',
            appliesTo: ['Projects'],
            formula: 'DAT01 Project Master.Contract Value',
          },
        ],
      },
      {
        id: 'kpi',
        name: 'KPI01 Executive Output',
        lineItemCount: 1,
        lineItems: [
          {
            id: 'kpi-margin',
            name: 'Margin %',
            format: { dataType: 'PERCENTAGE' },
            summary: { summaryMethod: 'SUM' },
            appliesTo: ['Projects'],
            formula: 'FIN01 Cost Calc.Project Cost / DAT01 Project Master.Contract Value',
          },
        ],
      },
    ],
  };
  const snapshot = buildAnalysisSnapshot(graphBlueprint);
  const intelligence = buildModelIntelligence(snapshot.normalized, snapshot.findings);

  assert.deepEqual(
    intelligence.graph.edges.map(e => `${e.fromModuleName}->${e.toModuleName}`).sort(),
    ['DAT01 Project Master->FIN01 Cost Calc', 'DAT01 Project Master->KPI01 Executive Output', 'FIN01 Cost Calc->KPI01 Executive Output']
  );
  assert.equal(intelligence.blastRadius.find(b => b.moduleName === 'DAT01 Project Master').downstreamModuleCount, 2);
  assert.equal(intelligence.regressionChecklist[0].moduleName, 'KPI01 Executive Output');
  assert(intelligence.evidenceSummary.includes('3 functional modules'));
  assert(intelligence.remediationPlan.some(step => step.stage === 'Summary and data hygiene fixes'));
  assert.equal(intelligence.architecture.layerCounts.data, 1);
  assert(intelligence.architecture.issues.some(issue => issue.ruleId === 'ARCH_OUTPUT_READS_RAW_LAYER'));
});

test('classifies architecture layers and flags non-slop structural issues', () => {
  const architectureBlueprint = {
    modelId: 'arch-model',
    modules: [
      {
        id: 'raw',
        name: 'DAT01 Raw Projects',
        lineItemCount: 2,
        lineItems: [
          { id: 'raw-cost', name: 'Cost', format: 'Number', summary: 'SUM', appliesTo: ['Projects'] },
          { id: 'raw-margin', name: 'Margin %', format: 'Percentage', summary: 'SUM', appliesTo: ['Projects'], formula: 'Revenue / Cost' },
        ],
      },
      {
        id: 'calc',
        name: 'CAL01 Project Logic',
        lineItemCount: 5,
        lineItems: [
          { id: 'calc-input', name: 'Manual Override', format: 'Number', summary: 'SUM', appliesTo: ['Projects'] },
          { id: 'calc-flag', name: 'Include', format: 'Boolean', summary: 'ANY', appliesTo: ['Projects'] },
          { id: 'calc-text', name: 'Status', format: 'Text', summary: 'None', appliesTo: ['Projects'] },
          { id: 'calc-rate', name: 'Margin %', format: 'Percentage', summary: 'SUM', appliesTo: ['Projects'], formula: 'DAT01 Raw Projects.Margin %' },
          { id: 'calc-wide', name: 'Wide Calc', format: 'Number', summary: 'SUM', appliesTo: ['A', 'B', 'C', 'D'], formula: '1' },
        ],
      },
      {
        id: 'out',
        name: 'KPI01 Board Output',
        lineItemCount: 1,
        lineItems: [
          { id: 'out-margin', name: 'Output Margin', format: 'Percentage', summary: 'SUM', appliesTo: ['Projects'], formula: 'DAT01 Raw Projects.Margin %' },
        ],
      },
    ],
  };
  const normalized = normalizeBlueprint(architectureBlueprint);
  const graph = buildDependencyGraph(normalized);
  const architecture = buildArchitectureClassification(normalized, graph);

  assert.equal(architecture.layerCounts.data, 1);
  assert.equal(architecture.layerCounts.calculation, 1);
  assert.equal(architecture.layerCounts.output, 1);
  assert(architecture.issues.some(issue => issue.ruleId === 'ARCH_DATA_MODULE_HAS_FORMULAS'));
  assert(architecture.issues.some(issue => issue.ruleId === 'ARCH_MIXED_RESPONSIBILITY_MODULE'));
  assert(architecture.issues.some(issue => issue.ruleId === 'ARCH_OUTPUT_READS_RAW_LAYER'));
});

test('builds evidence-backed workstreams instead of fake precision scoring', () => {
  const snapshot = buildAnalysisSnapshot(blueprint);

  assert.equal(snapshot.score.healthScore, null);
  assert.match(snapshot.score.verdict, /Review|Evidence Limited/);
  assert(snapshot.workstreams.length > 0);
  assert(snapshot.workstreams.length <= 6);
  assert.equal(snapshot.deterministicSuggestions.length, snapshot.workstreams.length);
  assert(snapshot.deterministicSuggestions.every(s => s.source === 'evidence-workstream'));
  assert(snapshot.deterministicSuggestions.every(s => s.workstream && Array.isArray(s.workstream.evidence)));
  assert(snapshot.intelligence.executiveNarrative.includes('no longer assigning a fake 0-100 precision score'));
});

test('workstreams consolidate high-volume low-risk metadata into one review agenda item', () => {
  const modules = Array.from({ length: 40 }, (_, i) => ({
    id: `sys-${i}`,
    name: `SYS${String(i + 1).padStart(2, '0')} Flags`,
    lineItemCount: 10,
    lineItems: Array.from({ length: 10 }, (_, j) => ({
      id: `flag-${i}-${j}`,
      name: `Flag ${j + 1}`,
      format: 'Boolean',
      summary: 'ANY',
      appliesTo: ['Products'],
    })),
  }));
  const snapshot = buildAnalysisSnapshot({ modelId: 'metadata-heavy', modules });

  assert.equal(snapshot.findings.length, 400);
  assert.equal(snapshot.workstreams.length, 1);
  assert.equal(snapshot.workstreams[0].id, 'metadata-governance');
  assert.equal(snapshot.workstreams[0].evidenceCount, 400);
  assert.equal(snapshot.deterministicSuggestions.length, 1);
});

test('downgrades architecture intelligence when dependency and naming evidence are weak', () => {
  const modules = [
    {
      id: 'mod1',
      name: 'MOD01 - General Settings',
      lineItemCount: 4,
      lineItems: [
        { id: 'a', name: 'Rate %', format: 'Percentage', summary: 'SUM', appliesTo: ['Products'] },
        { id: 'b', name: 'Status', format: 'Text', summary: 'None', appliesTo: ['Products'], formula: 'IF Rate % > 0 THEN "Open" ELSE "Closed"' },
      ],
    },
    {
      id: 'mod2',
      name: 'MOD02 - Scenario Settings',
      lineItemCount: 3,
      lineItems: [
        { id: 'c', name: 'Active', format: 'Boolean', summary: 'ANY', appliesTo: ['Versions'] },
      ],
    },
    {
      id: 'out',
      name: 'OUT01 Reporting',
      lineItemCount: 1,
      lineItems: [
        { id: 'd', name: 'Output Rate', format: 'Percentage', summary: 'SUM', appliesTo: ['Products'], formula: 'MOD01 - General Settings.Rate %' },
      ],
    },
  ];
  const snapshot = buildAnalysisSnapshot({ modelId: 'weak-evidence', modules });
  const diagnostics = snapshot.intelligence.diagnostics;

  assert.equal(snapshot.score.verdict, 'Evidence Limited');
  assert.equal(diagnostics.gates.dependencyGraph.status, 'weak');
  assert.equal(diagnostics.gates.architectureClassification.status, 'low_confidence');
  assert.equal(snapshot.intelligence.visualizations.showDependencyMap, false);
  assert.equal(snapshot.intelligence.visualizations.showLayerDistribution, false);
  assert.equal(snapshot.workstreams[0].id, 'evidence-admissibility');
  assert.match(snapshot.workstreams[0].action, /hold architecture remediation/i);
});
