import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface ISolidEntity extends IEntity {
    points: IPoint[];
    extrusionDirection: IPoint;
}
export default class Solid implements IGeometry {
    ForEntityName: "SOLID";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): ISolidEntity;
}
