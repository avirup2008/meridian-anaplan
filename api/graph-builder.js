// ─── Line-Item Graph Builder ─────────────────────────────────────────────────
// Constructs a line-item-level dependency graph from parsed formulas.
// Nodes = line items, Edges = formula references between them.

export function buildLineItemGraph(modules, parsedFormulas) {
  const nodes = new Map();
  const edges = [];
  const moduleSummaries = new Map();

  // Index for resolving references
  const itemByModuleAndName = new Map(); // "moduleId::itemName" → node
  const itemsByModuleName = new Map();   // "moduleName::itemName" → node

  // Step 1: Create all nodes
  for (const mod of modules) {
    for (const li of mod.lineItems) {
      const nodeId = `${mod.id}::${li.name}`;
      const node = {
        id: nodeId,
        name: li.name,
        moduleId: mod.id,
        moduleName: mod.name,
        format: li.formatType || '',
        summary: li.summaryMethod || '',
        dimensions: li.dimensions || [],
        hasFormula: li.hasFormula || false,
        isInput: li.isInput || false,
        formulaLength: li.formulaLength || 0,
        formulaTruncated: li.formulaTruncated || false,
      };

      // Attach parsed attributes if available
      const parsed = parsedFormulas.get(nodeId);
      if (parsed) {
        node.isSelfReferencing = parsed.isSelfReferencing;
        node.isAccumulation = parsed.isAccumulation;
        node.hasHardcodedMembers = parsed.hasHardcodedMembers;
        node.hasConditionals = parsed.hasConditionals;
        node.conditionalBranches = parsed.conditionalBranches;
        node.referencedModuleCount = parsed.referencedModuleCount;
        node.literals = parsed.literals;
      }

      nodes.set(nodeId, node);
      itemByModuleAndName.set(nodeId, node);
      itemsByModuleName.set(`${mod.name}::${li.name}`, node);
    }
  }

  // Step 2: Create edges from parsed references
  for (const [key, parsed] of parsedFormulas) {
    const targetNode = nodes.get(key);
    if (!targetNode) continue;

    // Cross-module edges: formula in targetNode reads from sourceNode
    for (const ref of parsed.crossModuleRefs) {
      const sourceNode = itemsByModuleName.get(`${ref.moduleName}::${ref.itemName}`);
      if (sourceNode && sourceNode.id !== targetNode.id) {
        const dimOp = parsed.dimensionalOps.find(op =>
          op.targetModule === ref.moduleName || op.targetItem === ref.itemName
        ) || null;
        edges.push({
          from: { moduleId: sourceNode.moduleId, moduleName: sourceNode.moduleName, itemId: sourceNode.id, itemName: sourceNode.name },
          to: { moduleId: targetNode.moduleId, moduleName: targetNode.moduleName, itemId: targetNode.id, itemName: targetNode.name },
          type: ref.context,
          dimensionalOp: dimOp ? { type: dimOp.type, dimension: dimOp.targetItem } : null,
          isCrossModule: true,
        });
      }
    }

    // Intra-module edges: formula in targetNode reads from sibling sourceNode
    for (const ref of parsed.intraModuleRefs) {
      const sourceId = `${parsed.moduleId}::${ref.itemName}`;
      const sourceNode = nodes.get(sourceId);
      if (sourceNode && sourceNode.id !== targetNode.id) {
        edges.push({
          from: { moduleId: sourceNode.moduleId, moduleName: sourceNode.moduleName, itemId: sourceNode.id, itemName: sourceNode.name },
          to: { moduleId: targetNode.moduleId, moduleName: targetNode.moduleName, itemId: targetNode.id, itemName: targetNode.name },
          type: ref.context,
          dimensionalOp: null,
          isCrossModule: false,
        });
      }
    }
  }

  // Step 3: Compute module summaries
  for (const mod of modules) {
    const modNodeIds = mod.lineItems.map(li => `${mod.id}::${li.name}`);
    const modNodeSet = new Set(modNodeIds);

    const inbound = edges.filter(e => modNodeSet.has(e.to.itemId) && !modNodeSet.has(e.from.itemId));
    const outbound = edges.filter(e => modNodeSet.has(e.from.itemId) && !modNodeSet.has(e.to.itemId));
    const internal = edges.filter(e => modNodeSet.has(e.from.itemId) && modNodeSet.has(e.to.itemId));

    const upstreamModules = [...new Set(inbound.map(e => e.from.moduleName))];
    const downstreamModules = [...new Set(outbound.map(e => e.to.moduleName))];

    const allDims = new Set();
    for (const li of mod.lineItems) {
      for (const d of (li.dimensions || [])) allDims.add(d);
    }

    const formulaCount = mod.lineItems.filter(li => li.hasFormula).length;
    const inputCount = mod.lineItems.filter(li => li.isInput).length;

    let role = 'isolated';
    if (inbound.length === 0 && outbound.length > 0) role = 'source';
    else if (outbound.length === 0 && inbound.length > 0) role = 'sink';
    else if (inbound.length > 5 && outbound.length > 5) role = 'hub';
    else if (inbound.length > 0 && outbound.length > 0) role = 'transformer';

    moduleSummaries.set(mod.id, {
      id: mod.id,
      name: mod.name,
      prefix: mod.prefix || '',
      dimensions: [...allDims],
      lineItemCount: mod.lineItems.length,
      formulaCount,
      inputCount,
      inboundEdges: inbound.length,
      outboundEdges: outbound.length,
      internalEdges: internal.length,
      upstreamModules,
      downstreamModules,
      role,
      grain: [...allDims].slice(0, 3).join(' × ') || 'Model-level',
    });
  }

  return { nodes, edges, modules: moduleSummaries };
}

// ─── Graph Query Utilities ───────────────────────────────────────────────────

export function computeItemFanOut(graph, itemId) {
  return graph.edges.filter(e => e.from.itemId === itemId).length;
}

export function computeItemFanIn(graph, itemId) {
  return graph.edges.filter(e => e.to.itemId === itemId).length;
}

export function getModuleItems(graph, moduleId) {
  return [...graph.nodes.values()].filter(n => n.moduleId === moduleId);
}

export function findBottlenecks(graph, topN = 20) {
  const fanOut = new Map();
  const fanIn = new Map();
  for (const edge of graph.edges) {
    fanOut.set(edge.from.itemId, (fanOut.get(edge.from.itemId) || 0) + 1);
    fanIn.set(edge.to.itemId, (fanIn.get(edge.to.itemId) || 0) + 1);
  }
  return [...graph.nodes.values()]
    .map(n => ({
      ...n,
      fanOut: fanOut.get(n.id) || 0,
      fanIn: fanIn.get(n.id) || 0,
    }))
    .filter(n => n.fanOut > 0 || n.fanIn > 0)
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, topN);
}

export function computeImpactScope(graph, itemId) {
  const affected = new Set();
  const affectedModules = new Set();
  const queue = [itemId];

  while (queue.length) {
    const current = queue.shift();
    const downstream = graph.edges
      .filter(e => e.from.itemId === current)
      .map(e => e.to.itemId);
    for (const next of downstream) {
      if (!affected.has(next)) {
        affected.add(next);
        const node = graph.nodes.get(next);
        if (node) affectedModules.add(node.moduleId);
        queue.push(next);
      }
    }
  }

  const outputModuleIds = [...affectedModules].filter(id => {
    const mod = graph.modules.get(id);
    return mod && /^(REP|OUT|KPI|SOP|IBP|DASH)/.test(mod.name);
  });

  return {
    affectedItemCount: affected.size,
    affectedModuleCount: affectedModules.size,
    affectedOutputCount: outputModuleIds.length,
    outputModuleNames: outputModuleIds.map(id => graph.modules.get(id)?.name).filter(Boolean),
  };
}

export function computeModuleImpact(graph, moduleId) {
  const modItems = getModuleItems(graph, moduleId);
  const combined = { affectedItemCount: 0, affectedModuleCount: 0, affectedOutputCount: 0, outputModuleNames: [] };
  const seenModules = new Set();
  const seenOutputs = new Set();

  for (const item of modItems) {
    const scope = computeImpactScope(graph, item.id);
    combined.affectedItemCount = Math.max(combined.affectedItemCount, scope.affectedItemCount);
    for (const m of scope.outputModuleNames) {
      if (!seenOutputs.has(m)) { seenOutputs.add(m); combined.outputModuleNames.push(m); }
    }
  }
  combined.affectedOutputCount = combined.outputModuleNames.length;
  return combined;
}

export function buildRiskClusters(graph, findings) {
  const clusters = [];

  // Cluster type 1: Hardcoded member fragility
  const byLiteral = new Map();
  for (const node of graph.nodes.values()) {
    if (!node.literals?.length) continue;
    for (const lit of node.literals) {
      if (!lit.value) continue;
      const key = `${lit.listName || 'unknown'}::${lit.value}`;
      if (!byLiteral.has(key)) byLiteral.set(key, []);
      byLiteral.get(key).push(node);
    }
  }
  for (const [key, nodes] of byLiteral) {
    if (nodes.length < 2) continue;
    const [listName, memberName] = key.split('::');
    const affectedModules = [...new Set(nodes.map(n => n.moduleName))];
    clusters.push({
      type: 'fragility',
      trigger: `Rename of '${memberName}'${listName !== 'unknown' ? ` in ${listName}` : ''}`,
      affectedItemCount: nodes.length,
      affectedModules,
      severity: nodes.length >= 5 ? 'Critical' : nodes.length >= 3 ? 'High' : 'Medium',
    });
  }

  // Cluster type 2: Connected modules with critical findings
  const criticalModuleIds = new Set(findings.filter(f => f.severity === 'critical').map(f => f.moduleId));
  const visited = new Set();
  for (const modId of criticalModuleIds) {
    if (visited.has(modId)) continue;
    const chain = [];
    const queue = [modId];
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      if (!criticalModuleIds.has(current) && current !== modId) continue;
      visited.add(current);
      chain.push(current);
      const mod = graph.modules.get(current);
      if (!mod) continue;
      for (const downstream of mod.downstreamModules) {
        const downId = [...graph.modules.values()].find(m => m.name === downstream)?.id;
        if (downId && !visited.has(downId)) queue.push(downId);
      }
    }
    if (chain.length >= 2) {
      clusters.push({
        type: 'cascading-risk',
        trigger: 'Connected modules with critical findings — errors propagate downstream',
        affectedItemCount: chain.reduce((sum, id) => sum + (graph.modules.get(id)?.lineItemCount || 0), 0),
        affectedModules: chain.map(id => graph.modules.get(id)?.name).filter(Boolean),
        severity: 'Critical',
      });
    }
  }

  const SEVERITY_RANK = { Critical: 0, High: 1, Medium: 2 };
  return clusters.sort((a, b) =>
    (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
    b.affectedItemCount - a.affectedItemCount
  );
}

export function detectBusinessPatterns(graph) {
  const patterns = [];

  for (const node of graph.nodes.values()) {
    if (!node.hasFormula) continue;

    if (node.isAccumulation) {
      patterns.push({ type: 'accumulation', moduleId: node.moduleId, moduleName: node.moduleName, itemName: node.name });
    }
    if (node.hasHardcodedMembers) {
      patterns.push({ type: 'hardcoded-member', moduleId: node.moduleId, moduleName: node.moduleName, itemName: node.name, literals: node.literals });
    }
  }

  // Module-level patterns
  for (const mod of graph.modules.values()) {
    const items = getModuleItems(graph, mod.id);
    const accumulations = items.filter(n => n.isAccumulation);
    if (accumulations.length >= 2) {
      patterns.push({ type: 'inventory-tracking', moduleId: mod.id, moduleName: mod.name, itemCount: accumulations.length });
    }
    const conditionalItems = items.filter(n => n.hasConditionals && n.conditionalBranches >= 2);
    if (conditionalItems.length >= 3) {
      patterns.push({ type: 'branching-logic', moduleId: mod.id, moduleName: mod.name, itemCount: conditionalItems.length });
    }
  }

  return patterns;
}

export function computeRemediationOrder(graph, targetModuleIds) {
  if (!targetModuleIds.length) return [];

  // Build module dependency subgraph
  const targetSet = new Set(targetModuleIds);
  const adj = new Map(); // upstream → downstream (fix upstream first)
  for (const modId of targetModuleIds) {
    const mod = graph.modules.get(modId);
    if (!mod) continue;
    adj.set(modId, []);
    for (const downName of mod.downstreamModules) {
      const downMod = [...graph.modules.values()].find(m => m.name === downName);
      if (downMod && targetSet.has(downMod.id)) {
        adj.get(modId).push(downMod.id);
      }
    }
  }

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map(targetModuleIds.map(id => [id, 0]));
  for (const [, deps] of adj) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }

  const sorted = [];
  const queue = targetModuleIds.filter(id => (inDegree.get(id) || 0) === 0);
  while (queue.length) {
    const current = queue.shift();
    sorted.push(current);
    for (const next of (adj.get(current) || [])) {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Group into parallel batches
  const batches = [];
  const completed = new Set();
  for (const modId of sorted) {
    const mod = graph.modules.get(modId);
    const deps = [...graph.modules.values()]
      .filter(m => mod?.upstreamModules.includes(m.name) && targetSet.has(m.id))
      .map(m => m.id);
    const canParallel = deps.every(d => completed.has(d));
    if (canParallel && batches.length > 0 && !batches[batches.length - 1].some(b => deps.includes(b.moduleId))) {
      batches[batches.length - 1].push({ moduleId: modId, moduleName: mod?.name || '' });
    } else {
      batches.push([{ moduleId: modId, moduleName: mod?.name || '' }]);
    }
    completed.add(modId);
  }

  return batches.map((items, i) => ({
    step: i + 1,
    parallel: items.length > 1,
    modules: items,
  }));
}
