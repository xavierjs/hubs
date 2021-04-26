// XAVIER: import some stuffs:
import readyPlayerMeMorphs from '../faceExpressions/readyPlayerMe.json';
import ThreeMorphAnimGeomBuilder from '../faceExpressions/ThreeMorphAnimGeomBuilder.js';

// XAVIER/ add settings;
const _webojiSettings = {
  nMorphs: 11,
  morphPrecision: 2048,
  rotationXOffset: -Math.PI/10,
  teethOpenFactor: 2,
  pivotYZ: [-1.5, 0],
  moveTeethBackward: 0.01 // move teeth a bit backward to avoid intersections with skin
};

/**
 * Stores networked avatar state.
 * @namespace avatar
 * @component networked-avatar
 */
AFRAME.registerComponent("networked-avatar", {
  schema: {
    left_hand_pose: { default: 0 },
    right_hand_pose: { default: 0 }
  }
});

// XAVIER:
function create_floatArray(n){ // typed arrays are encoded weirdly by JSON, so we use crappy job ones
  const r = new Array(n);
  for (let i=0; i<n; ++i){
    r[i] = 0.0;
  }
  return r;
}

AFRAME.registerComponent("faceExpressionsData", {
  schema: {
    isReady: { default: false },
    isDebug: { default: false },
    morphTargetInfluences: { default: create_floatArray(_webojiSettings.nMorphs) },
    rotation: { default: create_floatArray(3) },
    teethOpening: { default: 0 }
  },

  tick (){
    const data = this.data;
    if (!data || !data.isReady){
      return;
    }
    const threeObject3D = this.el.object3D;
    if (!threeObject3D){
      return;
    }

    if (!this.id && threeObject3D.el && threeObject3D.el.id !== 'avatar-rig'){
      //alert('networked-avatar id = ' + this.id);
      // this is not the current user avatar, so we need to apply face expressions
      apply_faceExpressions(threeObject3D, this.el.components.faceExpressionsData.data);
    }    

    //console.log('teethOpening', data.teethOpening);
    window.debugThreeObject3D = threeObject3D;

    // XAVIER: TODO: apply face expressions
  } // end tick()
});


function init_faceExpressions(threeObject3D, morphTargetInfluences){
  // extract meshes:

  let model = extract_threeNodeByName(threeObject3D, 'AvatarRoot');

  if (!model){
    return false;
  }
  model = model.parent;

  // extract model from scene and remove it from its parent:
  const morphAnimMeshRoot = model.parent;
  morphAnimMeshRoot.remove(model);

  // set parent and pivot:
  const morphAnimMeshParent = new THREE.Object3D();
  morphAnimMeshParent.matrixAutoUpdate = true;
  const morphAnimMeshParentPivot = new THREE.Object3D();
  morphAnimMeshParentPivot.matrixAutoUpdate = true;
  morphAnimMeshParent.add(morphAnimMeshParentPivot);

  const pivot = new THREE.Vector3(0, _webojiSettings.pivotYZ[0], _webojiSettings.pivotYZ[1]);
  morphAnimMeshParentPivot.position.copy(pivot);
  morphAnimMeshParent.position.copy(pivot).multiplyScalar(-1);
  morphAnimMeshRoot.add(morphAnimMeshParent);

  // get teeth:
  const teethMesh = extract_threeNodeByName(model, 'Wolf3D_Teeth');
  teethMesh.matrixAutoUpdate = true;
  teethMesh.material = cast_materialToBasic(teethMesh.material);
  teethMesh.position.set(0, 0, -_webojiSettings.moveTeethBackward);

  // transform some other mats to basic:
  ['eyeLeft', 'eyeRight', 'Wolf3D_Shirt'].forEach(function(partName){
    const partMesh = extract_threeNodeByName(model, partName);
    if (partMesh){
      partMesh.material = cast_materialToBasic(partMesh.material);
    }
  });

  const avatarFace = extract_threeNodeByName(model, 'Wolf3D_Head');
  if (!avatarFace){
    model.traverse(function(threeNode){
      if (threeNode.isSkinnedMesh) console.log(threeNode);
    });
  }

  const avatarFaceParent = avatarFace.parent;
  avatarFaceParent.remove(avatarFace);
  
  const basePositions = get_unflattenPositions(avatarFace.geometry);

  // create new morph mat, geom, mesh:
  const morphMat = create_avatarMorphMat(avatarFace.material);
  const morphGeom = ThreeMorphAnimGeomBuilder({
    data: readyPlayerMeMorphs,
    nMorphs: _webojiSettings.nMorphs,
    morphPrecision: _webojiSettings.morphPrecision,
    isUVFlipŶ: true,
    basePositions: basePositions
  });
  const morphAnimMesh = new THREE.Mesh(morphGeom, morphMat);
  morphMat.uniforms.morphJeelizRadius.value = morphGeom.userData.morphRadius;
  avatarFaceParent.add(morphAnimMesh);
  window.morphTargetInfluences = morphTargetInfluences;
  window.morphMat = morphMat;
  window.morphAnimMesh = morphAnimMesh;
  morphMat.uniforms.morphJeelizInfluences.value = morphTargetInfluences;

  morphAnimMeshParentPivot.add(model);

  Object.assign(threeObject3D.userData, {
    morphAnimMesh,
    morphAnimMeshParent,
    morphAnimMeshParentPivot,
    morphAnimMeshRoot,
    teethMesh
  });

  threeObject3D.userData.isMorphInitialized = true;
  return true;
}


function apply_faceExpressions(threeObject3D, faceExpressionsData){
  if (!threeObject3D.userData.isMorphInitialized){
    if (init_faceExpressions(threeObject3D, faceExpressionsData.morphTargetInfluences)){
      console.log('INFO in networked-avatar: weboji avatar initialized successfully');
    } else {
      return;
    }
  }
  update_avatar(threeObject3D.userData, faceExpressionsData);
}


function extract_threeNodeByName(model, name){
  let threeNodeFound = null;
  model.traverse(function(threeNode){
    if (threeNode.name === name){
      threeNodeFound = threeNode;
    }
  });
  return threeNodeFound;
}


function cast_materialToBasic(mat){
  if (mat.isMeshBasicMaterial){
    return mat;
  }
  return new THREE.MeshBasicMaterial({
    map: mat.map,
    color: 0xffffff,
    morphTargets: mat.morphTargets,
    fog: false
  });
}


function create_avatarMorphMat(oldMat){
  let nMorphs = _webojiSettings.nMorphs;
  if (nMorphs%2 !== 0) ++nMorphs;

  const threeMatTemplate = THREE.ShaderLib.basic;
  let vertexShaderSource = threeMatTemplate.vertexShader;
  let fragmentShaderSource = threeMatTemplate.fragmentShader;

  const uniforms = Object.assign({
    morphJeelizPrecision: {
      value: _webojiSettings.morphPrecision
    },
    morphJeelizRadius: {
      value: 1
    },
    'morphJeelizInfluences': {
      'value': new Float32Array(nMorphs)
    }}, threeMatTemplate.uniforms);

  // tweak shaders:
  function tweak_shaderAdd(code, chunk, glslCode){
    return code.replace(chunk, chunk+"\n"+glslCode);
  }
  function tweak_shaderDel(code, chunk){
    return code.replace(chunk, '');
  }
  function tweak_shaderRepl(code, chunk, glslCode){
    return code.replace(chunk, glslCode);
  }

  const nMorphsAttribs = nMorphs / 2;
  let glslMorphJeelizCode = ''
  const morphAttribs = [];
  for (let iMorph=0; iMorph<nMorphsAttribs; ++iMorph){
    const iA = 2 * iMorph;
    const iB = 2 * iMorph + 1;
    const iAStr = iA.toString();
    const iBStr = iB.toString();
    const iMorphStr = iMorph.toString();
    glslMorphJeelizCode +=
    'vec3 morphTargetJeeliz' + iAStr + ' = morphJeelizRadius*(vec3(-1.,-1.,-1.) + 2.*floor(morphJeeliz' + iMorphStr + ')/morphJeelizPrecision);\n'
    +'vec3 morphTargetJeeliz' + iBStr + ' = morphJeelizRadius*(vec3(-1.,-1.,-1.) + 2.*fract(morphJeeliz' + iMorphStr + '));\n'
    +'transformed += morphTargetJeeliz' + iAStr + ' * morphJeelizInfluences[' + iAStr + '];\n'
    +'transformed += morphTargetJeeliz' + iBStr + ' * morphJeelizInfluences[' + iBStr + '];\n';
    morphAttribs.push('morphJeeliz' + iMorphStr);
  }

  vertexShaderSource = tweak_shaderAdd(vertexShaderSource, '#include <common>',
    'uniform float morphJeelizInfluences[' + (2*nMorphsAttribs).toString() + '];\n'
    +'uniform float morphJeelizPrecision, morphJeelizRadius;\n'
    +'attribute vec3 ' + morphAttribs.join(',') + ';'
  );
  
  //vertexShaderSource = tweak_shaderDel(vertexShaderSource, '#include <worldpos_vertex>');
  vertexShaderSource = tweak_shaderRepl(vertexShaderSource, '#include <morphtarget_vertex>',
    glslMorphJeelizCode
  );

  // create mat:
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertexShaderSource,
    fragmentShader: fragmentShaderSource,
    morphTargets: false,
    lights: false,
    fog: false,
    transparent: true,
    side: THREE.BackSide,
    precision: 'highp',
    uniforms: uniforms
  });

  mat.map = oldMat.map
  mat.uniforms.map.value = oldMat.map;

  return mat;
}


function get_unflattenPositions(geom){
  const positionsFlatten = geom.attributes.position.array;
  const n = positionsFlatten.length/3;
  const r = new Array(n);
  for (let i = 0; i<n; ++i){
    r[i] = positionsFlatten.slice(i*3, i*3+3);
  }
  return r;
}


function update_avatar(threeObject3DUserData, faceExpressionsData){
  update_avatarFaceRotation(threeObject3DUserData.morphAnimMeshParent, faceExpressionsData.rotation);
  update_avatarTeeth(threeObject3DUserData.teethMesh, faceExpressionsData.teethOpening);
  update_avatarFaceExpressions(threeObject3DUserData.morphAnimMesh, faceExpressionsData.morphTargetInfluences);
  update_avatarOpacity(threeObject3DUserData.morphAnimMesh);
}


function update_avatarOpacity(morphAnimMesh){
  const mat = morphAnimMesh.material;
  mat.uniforms.opacity.value = mat.opacity;
}


function update_avatarTeeth(teethMesh, k){
   const morphIndex = teethMesh.morphTargetDictionary.mouthOpen;
  teethMesh.morphTargetInfluences[morphIndex] = _webojiSettings.teethOpenFactor * k;
}


function update_avatarFaceRotation(morphAnimMeshParent, rotation){
  const rx = 0.0; // mapped to rz, I don't know why
  const ry = -rotation[1];
  //const rz = rotation[2];
  const rz = -(rotation[0] + _webojiSettings.rotationXOffset);
  morphAnimMeshParent.rotation.set(rx, ry, rz, 'ZYX');
}


function update_avatarFaceExpressions(morphAnimMesh, morphTargetInfluences){
  morphAnimMesh.material.uniforms.morphJeelizInfluences.value = morphTargetInfluences;
}