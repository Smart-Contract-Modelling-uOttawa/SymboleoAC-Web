import { API_BASE } from '../config.js';
import type { ExplainModel } from '../explain/types.js';

export type Pos = { line: number; col: number };
export type Named = { name: string; line: number; col: number };
export type Norm = Named & {
  debtor?: string; creditor?: string; controller?: string; hasTrigger?: boolean;
};
export type RuleModel = Named & {
  action: string; permission: string; role: string; resource: string; controller: string;
};

export type Attr = { name: string; type: string; ref: boolean; modifier: string };
export type ClassType = Named & {
  parent: string | null; parentIsBase: boolean; category: string; thirdParty: boolean; attributes: Attr[];
};
export type EnumType = Named & { items: string[] };
export type DomainModel = { types: ClassType[]; enums: EnumType[] };

export type ContractModel = {
  domainName: string;
  contractName: string;
  domainCategories: Record<string, Named[]>;
  variableCategories: Record<string, Named[]>;
  domainModel: DomainModel;
  keywords: Record<string, Pos>;
  variables: Named[];
  obligations: Norm[];
  survivingObligations: Norm[];
  powers: Norm[];
  rules: RuleModel[];
  acControllers: string[];
  counts: { preconditions: number; postconditions: number; constraints: number };
  /** Structured explanation model (see web/src/explain/types.ts). Absent on old servers. */
  explain?: ExplainModel;
  /** Validation result of the same run; the Explain tab is gated on errors === 0. */
  diagnostics?: ModelDiagnostics;
};

export type ModelDiagnostics = {
  errors: number;
  warnings: number;
  issues: { severity: string; line: number; column: number; message: string }[];
};

export async function getModel(source: string): Promise<ContractModel | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ source }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as ContractModel;
  } catch {
    return null;
  }
}
