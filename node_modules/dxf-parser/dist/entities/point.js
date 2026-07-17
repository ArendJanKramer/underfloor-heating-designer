import * as helpers from '../ParseHelpers';
export default class Point {
    constructor() {
        this.ForEntityName = 'POINT';
    }
    parseEntity(scanner, curr) {
        const type = curr.value;
        const entity = { type };
        curr = scanner.next();
        while (!scanner.isEOF()) {
            if (curr.code === 0)
                break;
            switch (curr.code) {
                case 10:
                    entity.position = helpers.parsePoint(scanner);
                    break;
                case 39:
                    entity.thickness = curr.value;
                    break;
                case 210:
                    entity.extrusionDirection = helpers.parsePoint(scanner);
                    break;
                case 100:
                    break;
                default: // check common entity attributes
                    helpers.checkCommonEntityProperties(entity, curr, scanner);
                    break;
            }
            curr = scanner.next();
        }
        return entity;
    }
}
