# Mounted document geometry and layers

Each read or editable editor creates one `EditorDocumentGeometryOwner` during
initialization. The public runtime exposes `owner.reader` as `editor.geometry`;
the private render port retains registration authority.

`EditorDocument` attaches and detaches the current DOM host. Mounted blocks and
text surfaces register through the same private authority. The component does
not create or dispose geometry. Sequential detach and reattach are supported,
concurrent second-host attachment throws, and `editor.dispose()` performs final
owner disposal.

The reader measures canonical text carets and ranges, block selection targets,
and document-relative rectangles. It exposes a geometry revision subscription
driven by the owner's coalesced scroll, resize, font, layout, mutation, block
movement, content, and registration invalidation. Invalidation never mutates
canonical selection.

The shared PM-free document stack is:

```text
EditorDocument
`- BlockList / document host
   |- canonical block content
   `- EditorDocumentLayerStack
      |- SelectionPaintLayer(editor)
      `- CustomDocumentLayerHost
```

`EditorDocumentLayerRenderContext` exposes `editor`, canonical `selection`, and
the narrow `readBlockPlainText` reader. It has no duplicate geometry property;
layers use `context.editor.geometry`.

The built-in layer and product badge layer subscribe to the same geometry
reader and install no parallel resize, mutation, or scroll observers. The
built-in layer measures local and editable additional document paint. The badge
layer measures a logical focus target at render time and stores no rectangle.
Table contextual and internal selection borders render inside table DOM and do
not consume document geometry.

Hit testing, keyboard scrolling, edge scrolling, product resizing, and floating
panel collision layout remain distinct interaction responsibilities. Block
controls retain their existing positioning and never receive or subscribe to
`editor.geometry`.
