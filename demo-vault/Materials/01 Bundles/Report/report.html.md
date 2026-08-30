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

The declaration is marked by the `file-bundles` key, never by this note's name — so the note is an ordinary note, and anything else you want to say about the report can be written here.
