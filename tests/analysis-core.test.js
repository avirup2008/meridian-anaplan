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
} from '../api/analysis-core.js';
import { guardTokens, normalizeSynthesis } from '../api/analyze.js';

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
  const findings = scanDeterministicFindings(normalizeBlueprint(repeatedBlueprint));
  const rawPenaltyWouldBe = findings.reduce((sum, f) => sum + (f.severity === 'info' ? 1 : f.severity === 'warning' ? 2 : 4), 0);
  const score = scoreFindings(findings);

  assert.equal(findings.filter(f => f.ruleId === 'BOOLEAN_NAME_WEAK').length, 50);
  assert.equal(rawPenaltyWouldBe, 50);
  assert(score.healthScore > 85);
  assert(score.dimensions.naming > 85);
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
  const findings = scanDeterministicFindings(normalizeBlueprint(blueprint));
  const score = scoreFindings(findings);

  assert(score.healthScore < 80);
  assert.equal(score.verdict, 'Needs Work');
  assert(score.dimensions.formulas < 100);
  assert(score.dimensions.dataHygiene < 100);
  assert(score.dimensions.architecture < 100);
});

test('anchors synthesis score and keeps verdict consistent with final score', () => {
  const normalized = normalizeSynthesis(
    {
      healthScore: 99,
      verdict: 'Good',
      dimensions: {
        architecture: 100,
        naming: 100,
        formulas: 100,
        dataHygiene: 100,
        governance: 100,
      },
    },
    {
      healthScore: 65,
      verdict: 'Needs Work',
      dimensions: {
        architecture: 60,
        naming: 70,
        formulas: 50,
        dataHygiene: 80,
        governance: 90,
      },
    }
  );

  assert.equal(normalized.healthScore, 75);
  assert.equal(normalized.verdict, 'Needs Work');
  assert.equal(normalized.dimensions.formulas, 60);
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
  assert(intelligence.evidenceSummary.includes('3 modules'));
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
