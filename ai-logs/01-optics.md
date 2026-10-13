# 01: A Playable Lighting Model

**Reconstructed example, not an original prompt or executed conversation record.** Derived from the final implementation; no simulated reply or execution date is supplied.

## Example prompt

Implement an interactive lighting table within the existing application. Let users explore distance, incidence angle and obstruction by adjusting a scene, making a prediction and checking the result.

Use meters, candela and lux. Calculate direct illuminance from an ideal point source at a horizontal measurement point as `E = I × h / (dx² + dy² + h²)^(3/2)`. Add contributions from independent lamps. A direct path blocked by a configured opaque vertical screen contributes zero. Do not describe candela as electrical power.

Dragging and numeric controls must operate on the same physical coordinates. Validate lamps, measurement points and screens together when the table dimensions change; visual dimensions must remain consistent with the calculation. Room illustrations and material images are decorative and add no illumination to the model.

Provide Room, Light field and Paths views. State that the model excludes ambient light, reflections and directional output from real fixtures. Keep the existing code structure; do not introduce a large framework for this interaction.

## Acceptance criteria

- A 32 cd lamp directly above a measurement point produces approximately 50 lx at 0.8 m and 200 lx at 0.4 m.
- Dragging, numeric controls and exports use consistent coordinates and the same calculation function.
- Obstruction affects the relevant direct paths. Cancellation and invalid input preserve the existing scene.
- Readings are identified as model calculations, not physical measurements or lighting standards.
