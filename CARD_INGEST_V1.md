# Card ingest batch version 1

Status: local export contract, not a network API or an OpenCaselist downloader.

## Export

Install the root and desktop development dependencies as described in CARDMIRROR_GREEN.md. Run from the repository root on Windows or macOS:

```sh
npm run ingest:export -- --out batch.json "input.docx" "another.cmir"
```

The command reads original bytes, hashes them, uses the editor's importers, and writes a new JSON file. An existing output is never overwritten. Parse or provenance errors fail the whole batch before output is written. No documents are uploaded. The CLI does not add absolute input paths to provenance; source titles contain the input basenames. Rich snapshots may retain paths or links already present in the document. The batch contains the actual document contents, so treat it as sensitive as the originals.

## Envelope and classification

The envelope has `schema: "cardmirror.ingest.batch"`, `schemaVersion: 1`, `fingerprintAlgorithm: "sha256-canonical-json-v1"`, sources, records, summary counts and a deterministic batch ID. The machine-readable contract is schemas/card-ingest-batch-v1.schema.json. Breaking contract changes require a new major schemaVersion. The JSON Schema validates shape; consumers of untrusted external batches must additionally verify references, counts and hash consistency.

Every extracted container produces one record:

| recordType | Meaning |
|---|---|
| evidence | A card container with non-whitespace citation and body text |
| analytic | An analytic_unit, including heading-only analytics |
| tag_only | A card without substantive citation, body, undertag or rich content |
| incomplete | A remaining card, including uncited body text or rich-only content |

Classification describes structure, not source credibility, authorship, argument quality or citation correctness. Missing tags/IDs and incomplete evidence receive warnings. Analytics do not require a citation. Empty paragraphs and incomplete records are retained.

## Provenance and rich content

Adapters supply a unique logical source ID, original-file SHA-256 and format, plus an optional title and HTTP(S) source URI. The local CLI uses a source key derived from the original bytes and NFC-normalized basename. A future caselist adapter should use a stable disclosure/document key instead. Repeated identical source keys in one batch are rejected; supply one input per logical source.

Each record includes sourceId, sourceSha256, zero-based ordinal, original parsed headingId (nullable), and from/to ProseMirror snapshot offsets. Offsets apply to the exported document snapshot, not the original DOCX ZIP bytes. IDs in an imported DOCX may be synthesized; their persistence is not assumed.

`content` is the existing grouped paragraph/mark view. `rawNode` is the authoritative ordered ProseMirror node snapshot, preserving tables, images and other rich nodes. A `rich-content` warning means consumers must use rawNode rather than assume the paragraph view contains everything. The full parsed document snapshot also retains outlines, outside-card prose and derived references. Derived reference containers do not generate duplicate evidence records. This preserves the parsed editor snapshot; it is not an archive of every original Word XML part.

## Identity and deduplication

Canonical JSON sorts object keys in ECMAScript UTF-16 order, preserves array order, and uses JSON.stringify primitive escaping and number representation. Non-JSON primitive values are rejected. SHA-256 uses UTF-8 canonical JSON. contentHash hashes rawNode after removing only heading-node attrs.id fields. Marks, paragraph boundaries, order, citations and other attributes remain significant; no whitespace/case normalization or fuzzy matching occurs.

Record IDs hash `{sourceId, sourceSha256, ordinal, contentHash}`. Heading UUID regeneration does not change contentHash or record ID. New source bytes change record IDs even if extracted evidence is unchanged; contentHash can still connect those revisions. Batch IDs hash schema name/version, ordered `{id, sha256}` sources and ordered record IDs. Source/record order therefore matters. Export timestamps are omitted from identity.

All records are retained. duplicateOf points to the first identical contentHash in this batch, including identical records from another source. uniqueRecords and duplicates describe exact fingerprint groups across all record types. These IDs are not semantic claims that differently tagged cuts, edits or paraphrases are the same evidence.

## Next integration

The OpenCaselist adapter should populate source URI and logical disclosure ID, preserve original-byte hashes, and feed parsed documents into createIngestBatch. Downloading, remote authentication, storage, fuzzy deduplication and upload endpoints are not implemented here.
