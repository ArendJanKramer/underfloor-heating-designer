import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface ILineEntity extends IEntity {
    vertices: IPoint[];
    extrusionDirection: IPoint;
}
export default class Line implements IGeometry {
    ForEntityName: "LINE";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): ILineEntity;
}
