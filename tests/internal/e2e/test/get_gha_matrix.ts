import * as fs from 'fs';
import { getSpecGroups } from './specs_config';


function dumpGhaMatrix() {
    const versions = [23, 24];
    const result: { version: number, group: string }[] = [];

    versions.forEach(version => {
        const vcast24 = version === 24
        const specs = getSpecGroups(vcast24);
        Object.keys(specs).forEach(group => {
            result.push({ version, group });
        });
    });

    fs.writeFileSync('gha_matrix.json', JSON.stringify(result));
};

const groups = dumpGhaMatrix();