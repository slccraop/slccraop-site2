# Translation status

| Area                                                               | English     | Sinhala                        | Tamil                          |
| ------------------------------------------------------------------ | ----------- | ------------------------------ | ------------------------------ |
| Header, banner, home, ticker, ledger, statuses, categories, footer | done        | machine draft                  | machine draft                  |
| Report flow, withdraw, correction, evidence, case page, referral   | done        | English fallback               | English fallback               |
| How it works, methodology, about, contact                          | done        | English fallback               | English fallback               |
| Privacy, terms, consent                                            | placeholder | **human translation required** | **human translation required** |

Fallback pages show a visible "not available in your language yet" note. Have a native speaker review every machine draft before launch. Test `npm test` enforces that the first row has identical keys and variables in all three languages.
