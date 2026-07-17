import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface IPointEntity extends IEntity {
    position: IPoint;
    thickness: number;
    extrusionDirection: IPoint;
}
export default class Point implements IGeometry {
    ForEntityName: "POINT";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): IPointEntity;
}
