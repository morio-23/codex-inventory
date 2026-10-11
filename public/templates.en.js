// Built-in English templates use the same IDs and variables as the Japanese originals.
export default {
  "repo-map": {
    "title": "Repository map",
    "category": "Inspect",
    "description": "Repository entry points",
    "body": "Map the main directories, entry points, technology stack and development commands of the target repository. Do not edit files initially."
  },
  "focused-inspect": {
    "title": "Focused file inspection",
    "category": "Inspect",
    "description": "Limit inspection to relevant files",
    "body": "Goal: {goal}\nInspect only relevant files and cite file paths and line numbers. Do not edit anything."
  },
  "debug-root-cause": {
    "title": "Find the root cause",
    "category": "Bug",
    "description": "Cause and reproduction",
    "body": "Analyze this error by reproduction conditions, root cause and verification strategy:\n{error_message}\nDo not change code yet."
  },
  "minimal-fix": {
    "title": "Minimal bug fix",
    "category": "Build",
    "description": "Keep changes focused",
    "body": "Issue: {error_message}\nIdentify reproduction steps and cause, then implement and verify the smallest safe fix. Preserve existing behavior."
  },
  "feature": {
    "title": "Implement a feature",
    "category": "Build",
    "description": "Respect existing architecture",
    "body": "Feature request: {goal}\nReview existing conventions and tests, implement in small stages, and summarize changes and remaining work."
  },
  "diff-review": {
    "title": "Review changes",
    "category": "Review",
    "description": "Focus on the diff",
    "body": "Review the changes for bugs, regression risks and security issues in severity order.\nFiles: {selected_files}\nDiff summary: {diff_summary}\nDo not change files; cite evidence and propose fixes."
  },
  "security-review": {
    "title": "Security review",
    "category": "Review",
    "description": "Inputs and permissions",
    "body": "Review input validation, auth, secrets, path/command injection and outbound networking risks. Cite line numbers and do not make changes."
  },
  "test-design": {
    "title": "Design test cases",
    "category": "Test",
    "description": "Success, failure and edges",
    "body": "Feature: {goal}\nPropose happy-path, failure, edge and regression tests with acceptance criteria."
  },
  "e2e-fix": {
    "title": "Implement and rerun E2E",
    "category": "Test",
    "description": "Browser end-to-end tests",
    "body": "Feature: {goal}\nImplement browser E2E, run it, fix failures and rerun. Check console errors and behavior and report gaps."
  },
  "performance": {
    "title": "Profile performance",
    "category": "Inspect",
    "description": "Measure before optimizing",
    "body": "Target: {goal}\nBefore speculating, define measurable metrics, how to collect them and likely bottlenecks. Recommend evidence-based improvements."
  },
  "refactor-plan": {
    "title": "Refactoring plan",
    "category": "Plan",
    "description": "Split changes safely",
    "body": "Target: {selected_files}\nPlan incremental changes, dependencies, regression tests and rollback while preserving public APIs. Only propose a plan for now."
  },
  "docs-update": {
    "title": "Update documentation",
    "category": "Docs",
    "description": "Keep docs accurate",
    "body": "Changed behavior: {goal}\nUpdate the README and design docs based on actual implementation. Do not claim unimplemented or unverified work is done."
  },
  "pr-description": {
    "title": "Draft PR description",
    "category": "Docs",
    "description": "Easy to review",
    "body": "Change summary: {diff_summary}\nCreate a Markdown PR description covering motivation, changes, tests, breaking changes and remaining issues."
  },
  "ci-diagnosis": {
    "title": "Investigate CI failure",
    "category": "Bug",
    "description": "Use actual logs",
    "body": "Failed CI: {error_message}\nIdentify the failing step, reproduce it and distinguish environment issues from code defects. Fix and rerun."
  },
  "implementation-plan": {
    "title": "Plan before implementing",
    "category": "Plan",
    "description": "Scope, order and risks",
    "body": "Goal: {goal}\nBefore changing code, identify scope, design, implementation order, tests, risks and open decisions."
  },
  "finish-task": {
    "title": "Implement and verify",
    "category": "Build",
    "description": "Complete the workflow",
    "body": "Goal: {goal}\nInvestigate, implement, test, fix failures and rerun verification. Confirm before destructive changes or production deployment, and report PASS/FAIL/SKIP."
  }
};
