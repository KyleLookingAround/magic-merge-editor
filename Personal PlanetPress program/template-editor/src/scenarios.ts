// Scenario state shell. Carved out of legacy.ts as part of Phase 5.
//
// A "scenario" is one of the SampleDataFiles/*.xml files inside an
// .OL-datamapper.  When active, its leaf-element path → text-content map
// overrides the datamodel's lastValue substitution in the preview so the
// same template can be tested against many inputs without leaving the editor.
//
// All orchestrators that mutate this state (loadScenarios, renderScenarioPicker,
// applyScenario, openScenarioDiff, etc.) still live in legacy.ts; this export
// is the first step of that migration.

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
