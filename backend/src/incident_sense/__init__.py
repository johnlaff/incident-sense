"""incident-sense backend.

Two capabilities for a fictional bank's IT operations:

* **Resolution suggestion (RAG)** — retrieve similar past *resolved* incidents
  and suggest a grounded resolution for a new one.
* **Recurrence detection (clustering)** — surface recurring problems by
  clustering recent incidents, served from a precomputed, committed result.

All data is synthetic and the bank ("Banco Meridiano") is fictional.
"""

__version__ = "1.0.0"
