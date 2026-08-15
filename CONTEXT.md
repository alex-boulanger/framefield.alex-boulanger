# Framefield

Framefield is a local image lab for composing generated, imported, and text sources with destructive effects into artwork.

## Language

**Source Layer**:
A layer that contributes its own pixels to the artwork before later layers are applied. Field, image, and text layers are source layers.
_Avoid_: generator layer as a generic term

**Effect Layer**:
A layer that transforms the accumulated pixels beneath it and blends the result back into the stack.
_Avoid_: filter

**2D Text Layer**:
A source layer containing editable flat text that becomes part of the artwork and can be processed by later effect layers. Curved and 3D text are separate future capabilities, not part of this layer.
_Avoid_: caption, annotation, text effect, typography layer
