export type Step = {
  action: string
  result: string
  pendingTreatment: number
  handlerAvailable: boolean
  flagEnabled: boolean
  assignment?: "treatment" | "control"
  httpStatus?: number
  request?: string
  capturedAt?: string
  artifact?: string
}
export type Replay = {
  steps: Step[]
  final: { flagEnabled: boolean; handlerAvailable: boolean }
}
export type Evidence = {
  status: "verified"
  generatedAt: string
  flag: string
  scenario: string
  counterexample: string[]
  rule: string
  original: Replay
  revised: Replay
}
export type Scenario = {
  id: string
  title: string
  flag: string
  description: string
  expectedOriginal: number
  expectedRevised: number
}
export type PaymentPlan = "live" | "original" | "revised"
export type Payment = { status: number; message: string; capturedAt: string; plan: PaymentPlan; receipt?: string }
export type ScenarioState = {
  payments?: Partial<Record<PaymentPlan, Payment>>
  enabled: boolean
  assignment: "control" | "treatment"
  opened?: Step
  recovery?: boolean
  evidence?: Evidence
}
