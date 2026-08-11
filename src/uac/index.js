// User as Code (UaC) public API barrel — arXiv:2606.16707.
export { UaCMemory, compile, emptyUser, makeFact } from './core.js'
export { runRules, ruleDrugAllergy, ruleDrugInteraction, ruleBudget, ruleDiet } from './rules.js'
export { uacAnswer, retrievalAnswer, parseIntent } from './query.js'
export { toPython } from './codegen.js'
