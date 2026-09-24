---
file-bundles:
  main: "[[./report.html]]"
  files:
    - "[[./report-styles.css]]"
  folders:
    - ./Report images
---

# Quarterly report

The sidecar note for `report.html`. An HTML file cannot carry frontmatter, so this note declares the bundle on its behalf and names `report.html` as its `main`.

**Notice what this note is not called.** It is `Quarterly report.md`, not `report.html.md` — the declaration is marked by the `file-bundles` key and never by the file's name, so a sidecar is free to be called anything. Naming it after the file it bundles would only paint two rows labelled `report` in the File Explorer, since Obsidian strips `.md` from this one, and nothing on screen would say which is the report and which is the note declaring it.

So this is an ordinary note, and anything else you want to say about the report can be written here.
