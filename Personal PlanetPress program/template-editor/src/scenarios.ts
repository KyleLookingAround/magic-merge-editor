// Scenario state shell. Carved out of legacy.ts as part of Phase 5.
// scnPersistKey + parseScenarioXmlToMap carved out in Phase 6.
//
// A "scenario" is one of the SampleDataFiles/*.xml files inside an
// .OL-datamapper.  When active, its leaf-element path → text-content map
// overrides the datamodel's lastValue substitution in the preview so the
// same template can be tested against many inputs without leaving the editor.
//
// All orchestrators that mutate this state (loadScenarios, renderScenarioPicker,
// applyScenario, openScenarioDiff, etc.) still live in legacy.ts; this export
// is the first step of that migration.

import { state } from './state';

export interface Scenario {
  name: string;
  path: string;
  xmlText: string;
  valueByPath: Map<string, string>;
}

export interface ScenariosState {
  source: string | null;
  sourceHandle: FileSystemFileHandle | null;
  list: Scenario[];
  active: string | null;
  activeOverrides: Map<string, string> | null;
}

export const scenariosState: ScenariosState = {
  source: null,
  sourceHandle: null,
  list: [],
  active: null,
  activeOverrides: null,
};

// ============================================================
// SCENARIO HELPERS (carved from legacy.ts in Phase 6)
// ============================================================

/** localStorage key that persists the last-selected scenario per template. */
export function scnPersistKey(): string {
  return 'cw_scn:' + (state.fileName || '');
}

/** Walk an XML document and build a path→value map for every leaf element.
 *  Path is the dotted join of element names from root down. Each leaf is also
 *  indexed under every suffix of its path so substitution finds it regardless
 *  of how the datamodel names the field. First occurrence wins. */
export function parseScenarioXmlToMap(xmlText: string): Map<string, string> {
  const map = new Map<string, string>();
  let doc: Document;
  try { doc = new DOMParser().parseFromString(xmlText, 'application/xml'); }
  catch (_) { return map; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === 'parsererror') return map;
  function setIfAbsent(k: string, v: string) { if (k && !map.has(k)) map.set(k, v); }
  function walk(node: Element, ancestors: string[]) {
    for (const child of Array.from(node.children)) {
      const tag = child.localName || child.nodeName;
      const newAncestors = ancestors.concat([tag]);
      if (child.children && child.children.length > 0) {
        walk(child, newAncestors);
      } else {
        const value = (child.textContent || '').trim();
        for (let i = 0; i < newAncestors.length; i++) {
          setIfAbsent(newAncestors.slice(i).join('.'), value);
        }
      }
    }
  }
  walk(root, []);
  return map;
}
