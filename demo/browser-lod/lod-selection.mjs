const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const REF_TAN_HALF_FOV = Math.tan((22.5 * Math.PI) / 180);

export const pickLevel = (availableLevels, requestedLevel) => {
  if (availableLevels.includes(requestedLevel)) {
    return requestedLevel;
  }

  let bestLevel = availableLevels[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of availableLevels) {
    const distance = Math.abs(level - requestedLevel);
    if (
      distance < bestDistance ||
      (distance === bestDistance && level < bestLevel)
    ) {
      bestLevel = level;
      bestDistance = distance;
    }
  }
  return bestLevel;
};

export const chooseAutoLodLevel = ({
  availableLevels,
  lodLevels,
  distance,
  cameraFovDegrees,
  cameraAspect = 1,
  lodBaseDistance = 5,
  lodMultiplier = 3,
  lodBias = 0,
  lodRangeMin = 0,
  lodRangeMax = lodLevels - 1,
}) => {
  const maxLevel = Math.max(lodLevels - 1, 0);
  const rangeMin = clamp(lodRangeMin, 0, maxLevel);
  const rangeMax = clamp(Math.max(lodRangeMax, rangeMin), rangeMin, maxLevel);
  const tanHalfVFov = Math.tan((cameraFovDegrees * Math.PI) / 360);
  const tanHalfHFov = tanHalfVFov * Math.max(cameraAspect, 0.0001);
  const fovScale = Math.min(tanHalfVFov, tanHalfHFov) / REF_TAN_HALF_FOV;
  const fovAdjustedDistance = Math.max(distance, 0) * fovScale;

  let requestedLevel = 0;
  if (fovAdjustedDistance >= lodBaseDistance) {
    const rawLod =
      1 +
      Math.log(fovAdjustedDistance / lodBaseDistance) /
        Math.log(Math.max(lodMultiplier, 1.2));
    requestedLevel = Math.min(maxLevel, rawLod | 0);
  }
  requestedLevel = clamp(requestedLevel + lodBias, rangeMin, rangeMax);
  return pickLevel(availableLevels, clamp(requestedLevel, 0, maxLevel));
};
