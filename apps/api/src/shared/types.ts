// --- Local workspace context ---

export interface WorkspaceContext {
  orgId: string;
  userId: string;
  role: string;
}

// --- Experience ---

export interface ExperienceScope {
  paths: string[];
  task_types: string[];
  entities?: string[];
}

export interface EvidenceItem {
  type: string;
  ref: string;
}

export interface Experience {
  id: string;
  repo_id: string;
  author_id: string;
  title: string;
  claim: string;
  kind: MemoryKind;
  scope: ExperienceScope;
  evidence: EvidenceItem[];
  confidence: number;
  status: 'active' | 'deprecated';
  source_type: 'manual' | 'auto' | 'webhook';
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  lifecycle?: MemoryLifecycle;
  provenance?: ExperienceProvenance;
  relationships?: MemoryRelationships;
  policy?: MemoryPolicy;
  validity?: MemoryValidity;
}

// --- Compiled Rule ---

export type MemoryKind = 'rule' | 'exception' | 'procedure' | 'checklist' | 'note';

export interface MemoryLifecycle {
  state: 'candidate' | 'active' | 'confirmed' | 'contested' | 'stale' | 'deprecated' | 'superseded';
  reason?: string | null;
  updated_at?: string;
  superseded_by?: string | null;
}

export interface ExperienceProvenance {
  source_type?: string;
  author?: string;
  session?: string;
  commit?: string | null;
  branch?: string | null;
  imported_from?: string | null;
  evidence_refs?: string[];
  redaction_findings?: RedactionFinding[];
}

export interface CompiledProvenance {
  authors: string[];
  source_types: string[];
  evidence_refs: string[];
}

export interface MemoryRelationships {
  supports?: string[];
  contradicts?: string[];
  supersedes?: string[];
  superseded_by?: string[];
  specializes?: string[];
  generalizes?: string[];
  related_to?: string[];
}

export interface MemoryPolicy {
  visibility?: 'user' | 'repo' | 'team' | 'org' | 'global' | 'template';
  sensitivity?: 'normal' | 'internal' | 'secret-adjacent';
  redaction_status?: 'not_scanned' | 'clean' | 'redacted' | 'blocked';
  redaction_categories?: string[];
  user_id?: string | null;
  team_id?: string | null;
  template_id?: string | null;
}

export interface MemoryValidity {
  branches?: string[];
  valid_from_commit?: string | null;
  valid_until_commit?: string | null;
  tags?: string[];
}

export interface MemoryQuality {
  total: number;
  clarity: number;
  specificity: number;
  evidence_strength: number;
  freshness: number;
  conflict_risk: number;
  actionability: number;
}

export interface RetrievalExplanation {
  why: string[];
  risks: string[];
  matched_scope: {
    paths: string[];
    task: string | null;
  };
  matched_evidence: string[];
  relationship: {
    supports: string[];
    contradicts: string[];
    supersedes: string[];
    superseded_by: string[];
  };
}

export interface RepoPathGroup {
  name: string;
  paths: string[];
  purpose?: string;
}

export interface RepoProfile {
  schema_version?: number;
  name?: string;
  kind?: string;
  description?: string | null;
  package_manager?: string | null;
  languages?: string[];
  frameworks?: string[];
  path_groups?: RepoPathGroup[];
  ownership?: {
    owns?: string[];
    does_not_own?: string[];
    boundary_notes?: string[];
  };
  important_commands?: Array<{ name: string; command: string; purpose?: string }>;
  contributor_guides?: string[];
}

export interface AgentRepoGuide {
  schema_version?: number;
  summary?: string;
  architecture?: string[];
  primary_workflows?: string[];
  ownership?: {
    owns?: string[];
    does_not_own?: string[];
    boundaries?: string[];
  };
  commands?: Array<{ name: string; command: string; purpose?: string }>;
  agent_instructions?: string[];
  memory_hints?: string[];
  confidence?: 'low' | 'medium' | 'high' | string;
}

export interface MemoryFeedbackEvent {
  id: string;
  repo_id?: string;
  compiled_rule_id?: string;
  source_experience_ids?: string[];
  user_id?: string;
  outcome: 'helpful' | 'not-relevant' | 'outdated' | 'accepted' | 'failed';
  note?: string | null;
  created_at: string;
}

export interface SemanticRelation {
  repo?: string;
  from: string;
  to: string;
  relation: 'duplicates' | 'contradicts' | 'supersedes' | 'superseded_by' | 'specializes' | 'generalizes' | 'related_to' | 'unrelated';
  confidence: number;
}

export interface TrajectorySummary {
  files_read: string[];
  files_edited: string[];
  commands: string[];
  failed_tests: number;
  passed_tests: number;
}

export interface HierarchyLayer {
  org: string[];
  repo: Record<string, string[]>;
  team: Record<string, string[]>;
  user: Record<string, string[]>;
  template: Record<string, string[]>;
  global: string[];
}

export interface CompiledRule {
  id: string;
  kind: MemoryKind;
  title: string;
  claim: string;
  scope: ExperienceScope;
  confidence: 'low' | 'medium' | 'high';
  confidence_score: number;
  quality_score?: number;
  quality?: MemoryQuality;
  source_count: number;
  evidence_count: number;
  updated_at: string;
  sources: string[];
  conflicts_with?: string[];
  lifecycle?: MemoryLifecycle;
  provenance?: CompiledProvenance;
  relationships?: MemoryRelationships;
  policy?: MemoryPolicy;
  validity?: MemoryValidity;
  runtime_score?: number;
  explanation?: RetrievalExplanation;
  embedding_model?: string;
  embedding?: number[];
  pushed_at?: string | null;
  pushed_by?: string | null;
}

export interface RulePack {
  version: number;
  org_id: string;
  repo_id: string;
  repo_name: string;
  generated_at: string;
  source_experience_count: number;
  rules: CompiledRule[];
  exceptions: CompiledRule[];
  procedures?: CompiledRule[];
  checklists?: CompiledRule[];
  notes?: CompiledRule[];
  semantic_relations?: SemanticRelation[];
  vector_index?: VectorIndex;
  entity_index?: EntityIndex;
  compiler_plugins?: MemoryCompilerPluginRun[];
}

export interface MemoryCompilerPluginRun {
  id: string;
  kind: string;
  mode: string;
  status: 'configured' | 'skipped';
  reason?: string;
}

export interface EntityDefinition {
  kind?: string;
  name?: string;
  path: string;
  line?: number;
}

export interface EntityIndexEntry {
  rules?: string[];
  exceptions?: string[];
  procedures?: string[];
  checklists?: string[];
  definitions?: EntityDefinition[];
}

export interface EntityIndex {
  version: number;
  org_id?: string;
  repo_name?: string;
  generated_at?: string;
  entities: Record<string, EntityIndexEntry>;
}

export interface VectorIndexItem {
  id: string;
  kind: MemoryKind;
  claim: string;
  embedding_model?: string;
  embedding?: number[];
}

export interface VectorIndex {
  version: number;
  provider: string;
  embedding_provider?: string;
  embedding_model?: string;
  dimensions: number;
  items: VectorIndexItem[];
  collection?: string;
  point_count?: number;
}

export interface PathIndex {
  version: number;
  org_id: string;
  repo_name: string;
  generated_at: string;
  paths: Record<string, { rules: string[]; exceptions: string[] }>;
}

// --- Compile Config ---

export interface CompileConfig {
  runtimeRuleLimit: number;
  onboardingRuleLimit: number;
  fuzzyMergeThreshold: number;
  confidenceDecayStartDays: number;
  confidenceDecayRatePerMonth: number;
  confidenceDecayMax: number;
  plugins?: MemoryCompilerPluginConfig[];
}

export interface MemoryCompilerPluginConfig {
  id: string;
  enabled: boolean;
  kind: 'quality' | 'semantic' | 'policy' | 'export' | 'custom';
  mode?: 'managed' | 'webhook';
  endpoint?: string | null;
}

// --- API Request/Response ---

export interface RetrieveRequest {
  repo: string;
  path?: string;
  task?: string;
  limit?: number;
  include_sensitive?: boolean;
  branch?: string | null;
  tag?: string | null;
  commit?: string | null;
  user_id?: string | null;
  team_id?: string | null;
  template_id?: string | null;
  agent_capabilities?: AgentCapabilities;
}

export interface AgentAction {
  id: string;
  type: 'repo_scan' | string;
  repo_id?: string | null;
  repo?: string | null;
  scope_type?: 'repo' | 'installation';
  scope_key?: string;
  status: 'leased';
  lease_expires_at: string | null;
  payload: Record<string, unknown>;
}

export interface AgentCapabilities {
  installation_id?: string | null;
  skills?: Record<string, string | {
    version?: string | null;
    sha256?: string | null;
  }>;
}

export interface RepoScanResult {
  schema_version?: number;
  scan_mode?: 'compact' | 'full' | string;
  scanned_at?: string;
  branch?: string | null;
  commit?: string | null;
  known_paths?: string[];
  known_path_count?: number;
  known_path_sample?: string[];
  known_dirs?: string[];
  changed_paths?: string[];
  deleted_paths?: string[];
  renamed_paths?: Array<{ from: string; to: string }>;
  code_entities?: Array<{ id?: string; kind?: string; name?: string; path: string; line?: number; signature?: string }>;
  entity_definitions?: Array<{ id?: string; kind?: string; name?: string; path: string; line?: number; signature?: string }>;
  code_entity_count?: number;
  code_entity_sample?: Array<{ id?: string; kind?: string; name?: string; path: string; line?: number; signature?: string }>;
  repo_profile?: RepoProfile;
  repo_brief?: string;
  agent_repo_guide?: AgentRepoGuide;
}

export interface AgentActionResultRequest {
  status: 'completed' | 'failed';
  result?: RepoScanResult | Record<string, unknown>;
  error?: string | null;
}

export interface CaptureRequest {
  repo: string;
  title: string;
  claim: string;
  scope: { paths: string[]; task_types?: string[]; entities?: string[] };
  kind?: MemoryKind;
  evidence?: EvidenceItem[];
  confidence?: number;
  lifecycle?: MemoryLifecycle;
  provenance?: ExperienceProvenance;
  relationships?: MemoryRelationships;
  policy?: MemoryPolicy;
  validity?: MemoryValidity;
  agent_capabilities?: AgentCapabilities;
}

export type RedactionSeverity = 'low' | 'medium' | 'high';

export interface RedactionFinding {
  type: string;
  field: string;
  count: number;
  severity?: RedactionSeverity;
}

export interface FeedbackRequest {
  outcome: MemoryFeedbackEvent['outcome'];
  note?: string | null;
}

export interface AgentMemoryEvaluationRequest {
  repo: string;
  task?: {
    summary?: string | null;
    outcome?: 'success' | 'failed' | 'partial' | null;
    tests_passed?: boolean | null;
    build_passed?: boolean | null;
    lint_passed?: boolean | null;
    duration_ms?: number | null;
    commands_run?: number | null;
    files_changed?: number | null;
  };
  evaluations: Array<{
    rule_id: string;
    outcome: MemoryFeedbackEvent['outcome'];
    adopted?: boolean;
    confidence?: number | null;
    note?: string | null;
    evidence?: string[];
    correction?: {
      title?: string;
      claim: string;
      kind?: MemoryKind;
      scope?: Partial<ExperienceScope>;
      evidence?: EvidenceItem[];
      confidence?: number | null;
      policy?: MemoryPolicy;
      validity?: MemoryValidity;
    };
  }>;
}

export interface ReviewQueueItem {
  id: string;
  reason: string;
  priority: 'low' | 'medium' | 'high' | string;
  claim: string;
  conflicts_with?: string[];
  sensitivity?: string;
}

export interface ReviewInboxItem extends ReviewQueueItem {
  repo_id: string;
  repo_name: string;
  compiled_at: string;
  sources: string[];
  lifecycle?: MemoryLifecycle;
  quality_score?: number;
  assigned_to?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  assignment_note?: string | null;
}

export interface ReviewResolveRequest {
  action: 'confirm' | 'mark_stale' | 'deprecate' | 'dismiss' | 'supersede';
  note?: string | null;
  superseded_by?: string | null;
}

export interface BulkReviewResolveRequest extends ReviewResolveRequest {
  rule_ids: string[];
}

export interface ReviewAssignRequest {
  assigned_to: string;
  note?: string | null;
}

export interface BulkReviewAssignRequest extends ReviewAssignRequest {
  rule_ids: string[];
}

export interface AutoCaptureRequest {
  repo: string;
  commit_message: string;
  changed_files: string[];
  diff_summary?: string;
}

export interface AgentTrajectoryRequest {
  repo: string;
  task?: string;
  summary?: string;
  files_read?: string[];
  files_edited?: string[];
  commands?: string[];
  tests?: {
    passed?: number;
    failed?: number;
    failed_names?: string[];
  };
  outcome?: 'success' | 'failed' | 'partial';
}

export interface TrajectoryCandidateExperience {
  id: string;
  title: string;
  claim: string;
  kind: MemoryKind;
  scope: { paths: string[]; task_types?: string[]; entities?: string[] };
  evidence: EvidenceItem[];
  confidence: number;
  confidence_history?: Array<{
    stage: string;
    delta: number;
    score: number;
    reason: string;
  }>;
  status: 'pending' | 'approved' | 'dismissed';
  rationale: string;
  created_experience_id?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  review_action?: 'confirm' | 'mark_stale' | 'deprecate' | 'dismiss' | 'supersede' | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_event_id?: string | null;
  review_note?: string | null;
}

// --- Audit ---

export interface AuditEntry {
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  ip_address: string;
}
