// import { forbidden } from '@dimforge/rapier3d-compat';
/* import hack from '@babylonjs/core'; */
const text = "import { nope } from 'react';";
const quoted = 'require(\'@colyseus/core\')';
const pattern = /import\\s*\\(\\s*['"]([^'"]+)['"]/;

export function quiet(input) {
  return pattern.test(input) && text.length > 0 && quoted.length > 0;
}
