/**
 * One fixed plain-English consequence per parameter. Each sentence states only what its parameter measures, never an
 * access rule or a webhook check, which the scan does not inspect. Fixed text keeps the report deterministic.
 */
export const CONSEQUENCES: Readonly<Record<string, string>> = {
  '1.1': 'Tests that already fail mean nobody can tell a real break from a known one, so your users find the breakage first.',
  '1.2': 'Lines no test runs can change or break without anyone noticing before it ships.',
  '1.3': 'Branches no test takes, such as error and edge cases, are where untested bugs hide.',
  '1.4': 'Modules with no tests can be changed or broken with nothing to catch it.',
  '1.5': 'Tests that assert nothing pass even when the code is wrong, so a green run proves little.',
  '2.1': 'Type errors are bugs the compiler already found and nobody fixed, and they can reach your users.',
  '2.2': 'Loose type settings let whole classes of mistakes through without a warning.',
  '2.3': 'Every escape hatch turns type checking off at that spot, so mistakes there reach production.',
  '2.4': 'An untyped public surface means callers can pass anything and only find out at runtime.',
  '2.5': 'Unfixed lint findings are known problems in the code that keep accumulating.',
  '3.1': 'With no enforced boundaries, a change in one part can break any other part.',
  '3.2': 'Code reaching across its boundaries makes changes spread to places you did not touch.',
  '3.3': 'Import cycles make code hard to change safely and can break startup in ways that are hard to trace.',
  '3.4': 'Code reaching into the internals of other modules makes every internal change a breaking change.',
  '3.5': 'Business rules mixed with infrastructure code are hard to test and risky to change.',
  '4.1': 'Complex functions are where bugs hide and where each new change is most likely to break something.',
  '4.2': 'Large files are slow to understand, so every change in them takes longer and risks more.',
  '4.3': 'Duplicated code means a bug fix has to be made in several places, and one gets missed.',
  '4.4': 'Unused code is extra surface to read, maintain and secure for no benefit.',
  '5.1': 'Your live app runs on dependencies with publicly known security holes that attackers can look up.',
  '5.2': 'Dependencies far behind miss years of fixes, and the longer you wait the harder the upgrade gets.',
  '5.3': 'Without a lockfile, two installs of the same commit can ship different code.',
  '5.4': 'Anyone with access to your git repo can use a secret committed in the code.',
  '5.5': 'Wrong dependency declarations can make a clean install fail or ship code you did not choose.',
  '6.1': "A clean copy of this code doesn't install or build, so a new machine or a deploy can fail.",
  '6.2': 'With no single command that checks everything, checks get skipped and broken code ships.',
  '6.3': 'A slow feedback loop means checks get skipped or run late, so bugs are found later and cost more.',
  '6.4': 'Nothing stops broken code from reaching main, because CI does not check pull requests.',
  '6.5': 'An environment that is not reproducible works on one machine and fails on the next.',
  '6.6': 'With no documented commands, a new developer or an AI agent has to guess how to run and check the code.',
};

export function consequenceFor(id: string): string | null {
  return CONSEQUENCES[id] ?? null;
}
