# Fictional membership intake records

## Source and permissions

I generate every input and label in `src/llm_eval/data.py`. There are no scraped records, real identities, addresses, contacts, private sources or external datasets. Names are explicitly artificial `Fiction-1234` strings, and member IDs start with `SYN-`. I dedicate generated data to the public domain under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/). Project code is MIT; the separate model is [Apache-2.0](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct).

## Construction

The default recipe produces 512 training, 64 validation and 128 held-out rows from 352 fictional members. The recorded CPU benchmark uses 128/16/32 rows from 88 members. Seed 42 controls the entity shuffle, values, missingness, templates and row shuffle. Six templates vary field order, labels, punctuation and prose. Every member appears in two different templates; the second record adds an unrelated order note whose status must not replace the membership status.

The target has exactly four fields: `name` (fabricated string), `member_id` (unique synthetic identifier), `region` (north/south/east/west or null), and `status` (active/pending/closed). Region is withheld with probability 0.2 per member, rendered as `not provided` and labeled JSON null. Every other field is present. No labels come from another language model.

I partition shuffled members first, then write variants, so an entity cannot cross splits. An audit rejects repeated normalized text, repeated row IDs, and overlapping members or complete target dictionaries between splits. Variants of one member intentionally share their target within a split. A manifest records generation version, counts, seed and SHA-256 hashes of the three files. Both training and evaluation verify hashes and re-run the audit through Hugging Face Datasets.

## Intended use and limits

This is a controlled extraction and formatting experiment, useful for comparing training choices without exposing people. It is not an identity verification system and must not make decisions about people. The same six templates occur in all splits; this tests unseen members within a known template family, not unseen document styles. A tiny model and a small synthetic vocabulary say little about messy real forms, multilingual text, handwriting, fairness or adversarial input. A low score is a valid measured result, not a reason to change the held-out set.

Validation measures completion loss only. Test rows are never tokenized into the training or validation datasets. Evaluation can use an explicitly recorded prefix with `--limit`; the default uses the full held-out split. Such a prefix is a smoke check and should not be presented as a full-set result.
