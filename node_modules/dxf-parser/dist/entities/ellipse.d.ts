import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface IEllipseEntity extends IEntity {
    center: IPoint;
    majorAxisEndPoint: IPoint;
    axisRatio: number;
    startAngle: number;
    endAngle: number;
    name: string;
}
export default class Ellipse implements IGeometry {
    ForEntityName: "ELLIPSE";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): IEllipseEntity;
}
