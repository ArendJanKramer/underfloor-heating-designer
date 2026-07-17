import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface IVertex extends IPoint {
    startWidth: number;
    endWidth: number;
    bulge: number;
}
export interface ILwpolylineEntity extends IEntity {
    vertices: IVertex[];
    elevation: number;
    depth: number;
    shape: boolean;
    hasContinuousLinetypePattern: boolean;
    width: number;
    extrusionDirectionX: number;
    extrusionDirectionY: number;
    extrusionDirectionZ: number;
}
export default class Lwpolyline implements IGeometry {
    ForEntityName: "LWPOLYLINE";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): ILwpolylineEntity;
}
