# Agent instructions for StudentCourseTranscript-Extension

This repo is a MetaEd extension (namespace `EdFiX`) to Ed-Fi Data Standard 6.2
that adds a `StudentCourseTranscript` entity.

## Layout

- `metaed-config.json` builds two projects together: the Ed-Fi 6.2 core model
  (`node_modules/@edfi/ed-fi-model-6.2`) and this extension (`package/`, project
  `StudentCourseTranscript`, namespace `EdFiX`).
- Extension sources live in `package/`, one folder per MetaEd entity type:
  `package/Domain/`, `package/DomainEntity/`, `package/Descriptor/`. Add new
  entities in the matching folder (e.g. `package/Common/` for a `Common`).
- Core entities are referenced with the `EdFi.` prefix (e.g.
  `domain entity EdFi.Course`).
- Domain entities must be listed in the `Domain` file
  (`package/Domain/StudentCourseTranscriptModel.metaed`).

## Build / validation

```shell
npm ci        # install packages
npm start     # run the build; output is in package/MetaEdOutput/

# show only errors
npm start 2>&1 | grep '"level":"error"'
```

- Logs are JSON lines; treat any `{"level":"error"...}` line as a build failure.
- CLI help: `node node_modules/@edfi/metaed-console/dist/index.js --help`
- When you finish a turn, a Stop hook (`.claude/hooks/metaed-build.mjs`)
  runs the build if `.metaed` files have uncommitted changes not yet built, so you do not need to
  run it yourself. A block means the build reported errors: fix them.

## MetaEd authoring conventions

Every property needs a constraint line, otherwise MetaEd fails to parse. Patterns
used in this repo:

- `is required`, `is optional`, `is optional collection`, `is part of identity`
- `descriptor`, `domain entity`, `common`, and `inline common` properties
- `role name` to disambiguate repeated types (e.g. two `EdFi.Credits`)
- `shared string` / `shared decimal` with `named` for a renamed reuse of a
  shared scalar
- `merge A.B with C.D` to align overlapping reference keys
- `max length` on strings

Make a small `.metaed` change, check the build output, fix errors, repeat.

## After editing

Run the `review-model-pr` skill (`/review-model-pr`) to review your MetaEd
changes against the Ed-Fi-Model checklist.
