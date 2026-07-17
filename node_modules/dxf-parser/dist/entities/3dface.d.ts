import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface I3DfaceEntity extends IEntity {
    shape: boolean;
    hasContinuousLinetypePattern: boolean;
    vertices: IPoint[];
}
export default class ThreeDface implements IGeometry {
    ForEntityName: "3DFACE";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): I3DfaceEntity;
}
