import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface IInsertEntity extends IEntity {
    name: string;
    xScale: number;
    yScale: number;
    zScale: number;
    position: IPoint;
    rotation: number;
    columnCount: number;
    rowCount: number;
    columnSpacing: number;
    rowSpacing: number;
    extrusionDirection: IPoint;
}
export default class Insert implements IGeometry {
    ForEntityName: "INSERT";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): IInsertEntity;
}
