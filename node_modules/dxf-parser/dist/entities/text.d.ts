import DxfArrayScanner, { IGroup } from '../DxfArrayScanner';
import IGeometry, { IEntity, IPoint } from './geomtry';
export interface ITextEntity extends IEntity {
    startPoint: IPoint;
    endPoint: IPoint;
    textHeight: number;
    xScale: number;
    rotation: number;
    text: string;
    halign: number;
    valign: number;
}
export default class Text implements IGeometry {
    ForEntityName: "TEXT";
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): ITextEntity;
}
