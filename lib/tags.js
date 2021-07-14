cleanTags = (tags) => {
    return tags.replace(/[^0-9A-Za-z,_ +-]/gi, '_');
};

possibleTags = (tags, db) => {
    const checkedTags = db.get('tags').filter(t => t.checked).value().map(t => t.value);
    const currentTags = tags ? tags.split(',') : [];
    const possible = checkedTags.concat(currentTags);
    return "[" + possible.map(v => `{value: "${v}", text: "${v}"}`).join(',') + "]";
}

exports.cleanTags = cleanTags;
exports.possibleTags = possibleTags;
