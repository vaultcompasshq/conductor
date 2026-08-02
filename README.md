# Compass

Working name. Umbrella repo for the Vault & Compass guardrail stack.

We ship independent gates for AI-assisted development:
[Conductor](https://github.com/vaultcompasshq/conductor) freezes an approved
intent contract and blocks scope drift, and
[Vault Guard](https://github.com/vaultcompasshq/vault-guard) stops secrets
from landing in a commit. A dependency gate is in the works. Each one
installs on its own, runs offline, and needs no account. They also don't
know about each other, which is deliberate, but it leaves anyone running
the full stack with three inits, three config files, and three output
shapes to parse.

This repo is where that gets consolidated eventually: one policy file, an
installer that wires up whichever gates a repo wants, and a common report.
There is no code here yet. Design comes first, same bar as the other
repos.

## License

MIT, [Vault & Compass](https://vaultcompass.io)
