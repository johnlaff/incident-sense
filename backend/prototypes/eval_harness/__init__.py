"""Throwaway prototype — the eval harness contract, made concrete.

PROTOTYPE — not production. This package exists to answer wayfinding ticket #22
("Prototipar o harness bilíngue de evals conversacionais"): what concrete shape
of dataset, adapters, runner, graders, reports and CI integration makes the eval
contract (#20) executable, reproducible and provider-neutral in *this* codebase.

It is deliberately located next to the code it evaluates (``incident_sense``) and
named ``prototypes/`` so a casual reader sees it is not the product. It is kept
out of ``mypy src`` and out of ``testpaths`` on purpose (see NOTES.md, decision
about CI integration). Delete or absorb once the harness form is ratified.
"""
