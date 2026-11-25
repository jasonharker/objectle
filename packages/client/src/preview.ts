// Development page: a fixture model and a near-black Ghost drawn through the
// normalization shader on the game's phone layout. Not part of the build.
import { binoculars, teapot } from './fixture-models.ts';
import { drawStage } from './stage-view.ts';

const canvas = document.createElement('canvas');
document.querySelector('#stage')!.append(canvas);
drawStage(canvas, teapot(), [binoculars()]);
