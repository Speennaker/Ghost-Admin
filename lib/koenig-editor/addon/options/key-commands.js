import Browser from 'mobiledoc-kit/utils/browser';
import {
    CURSOR_AFTER,
    CURSOR_BEFORE,
    SPECIAL_MARKUPS
} from '../components/koenig-editor';

// Key commands will run any time a particular key or key combination is pressed
// https://github.com/bustlelabs/mobiledoc-kit#configuring-hot-keys

export const DEFAULT_KEY_COMMANDS = [{
    str: 'ENTER',
    run(editor, koenig) {
        let {isCollapsed, head: {offset, section}} = editor.range;

        // if cursor is at beginning of a heading, insert a blank paragraph above
        if (isCollapsed && offset === 0 && section.tagName && section.tagName.match(/^h\d$/)) {
            editor.run((postEditor) => {
                let newPara = postEditor.builder.createMarkupSection('p');
                let collection = section.parent.sections;
                postEditor.insertSectionBefore(collection, newPara, section);
            });
            koenig._scrollCursorIntoView();
            return;
        }

        return false;
    }
}, {
    // CMD+ENTER is our keyboard shortcut for putting a selected card into edit mode
    str: 'META+ENTER',
    run(editor, koenig) {
        if (koenig.selectedCard) {
            koenig.editCard(koenig.selectedCard);
            return;
        }

        return false;
    }
}, {
    // CTRL+ENTER is our keyboard shortcut for putting a selected card into edit mode
    str: 'CTRL+ENTER',
    run(editor, koenig) {
        if (Browser.isWin() && koenig.selectedCard) {
            koenig.editCard(koenig.selectedCard);
            return;
        }

        return false;
    }
}, {
    str: 'SHIFT+ENTER',
    run(editor) {
        if (!editor.range.headSection.isMarkerable) {
            return;
        }

        editor.run((postEditor) => {
            let softReturn = postEditor.builder.createAtom('soft-return');
            postEditor.insertMarkers(editor.range.head, [softReturn]);
        });
    }
}, {
    str: 'BACKSPACE',
    run(editor, koenig) {
        let {head, isCollapsed, head: {marker, offset, section}} = editor.range;
        let {next, prev} = section;

        // if a card is selected we should delete the card then place the cursor
        // at the end of the previous section
        if (koenig.selectedCard) {
            let cursorPosition = section.prev ? CURSOR_BEFORE : CURSOR_AFTER;
            koenig.deleteCard(koenig.selectedCard, cursorPosition);
            return;
        }

        // if the cursor is at the beginning of the doc and on a blank paragraph,
        // then delete or re-create the paragraph to remove formatting
        let sections = section.isListItem ? section.parent.parent.sections : section.parent.sections;
        let isFirstSection = section === sections.head;
        if (isFirstSection && isCollapsed && offset === 0 && (section.isBlank || section.text === '')) {
            editor.run((postEditor) => {
                // remove the current section
                postEditor.removeSection(section);

                // select the next section
                if (next) {
                    return;
                }

                // we don't have another section so create a blank paragraph
                // which will have the effect of removing any formatting
                let {builder} = postEditor;
                let p = builder.createMarkupSection('p');
                postEditor.insertSectionAtEnd(p);
                postEditor.setRange(p.tailPosition());
            });

            // allow default behaviour which will trigger `cursorDidChange` and
            // fire our `cursorDidExitAtTop` action
            return;
        }

        // if the section about to be deleted by a backspace is a card then
        // actually delete the card rather than selecting it.
        // However, if the current paragraph is blank then delete the paragraph
        // instead - allows blank paragraphs between cards to be deleted and
        // feels more natural
        if (isCollapsed && offset === 0 && prev && prev.type === 'card-section' && !section.isBlank) {
            let card = koenig.getCardFromSection(prev);
            koenig.deleteCard(card);
            return;
        }

        // if cursor is at the beginning of a heading and previous section is a
        // blank paragraph, delete the blank paragraph
        if (isCollapsed && offset === 0 && section.tagName.match(/^h\d$/) && prev && prev.tagName === 'p' && prev.isBlank) {
            editor.run((postEditor) => {
                postEditor.removeSection(prev);
            });
            return;
        }

        // if the markup about to be deleted is a special format (code, strike)
        // then undo the text expansion to allow it to be extended
        if (isCollapsed && marker) {
            let specialMarkupTagNames = Object.keys(SPECIAL_MARKUPS);
            let hasReversed = false;
            specialMarkupTagNames.forEach((tagName) => {
                // only continue if we're about to delete a special markup
                let markup = marker.markups.find(markup => markup.tagName.toUpperCase() === tagName);
                if (markup) {
                    let nextMarker = head.markerIn(1);
                    // ensure we're at the end of the markup not inside it
                    if (!nextMarker || !nextMarker.hasMarkup(tagName)) {
                        // wrap with the text expansion, remove formatting, then delete the last char
                        editor.run((postEditor) => {
                            let markdown = SPECIAL_MARKUPS[tagName];
                            let range = editor.range.expandByMarker(marker => !!marker.markups.includes(markup));
                            postEditor.insertText(range.head, markdown);
                            range = range.extend(markdown.length);
                            let endPos = postEditor.insertText(range.tail, markdown);
                            range = range.extend(markdown.length);
                            postEditor.toggleMarkup(tagName, range);
                            endPos = postEditor.deleteAtPosition(endPos, -1);
                            postEditor.setRange(endPos);
                        });
                        hasReversed = true;
                    }
                }
            });
            if (hasReversed) {
                return;
            }
        }

        return false;
    }
}, {
    str: 'DEL',
    run(editor, koenig) {
        let {isCollapsed, head: {offset, section}} = editor.range;

        // if a card is selected we should delete the card then place the cursor
        // at the beginning of the next section or select the following card
        if (koenig.selectedCard) {
            let selectNextCard = section.next.type === 'card-section';
            let nextCard = koenig.getCardFromSection(section.next);

            koenig.deleteCard(koenig.selectedCard);

            if (selectNextCard) {
                koenig.selectCard(nextCard);
            }
            return;
        }

        // if the section about to be deleted by a DEL is a card then actually
        // delete the card rather than selecting it
        // However, if the current paragraph is blank then delete the paragraph
        // instead - allows blank paragraphs between cards to be deleted and
        // feels more natural
        if (isCollapsed && offset === section.length && section.next && section.next.type === 'card-section' && !section.isBlank) {
            let card = koenig.getCardFromSection(section.next);
            koenig.deleteCard(card, CURSOR_BEFORE);
            return;
        }

        return false;
    }
}, {
    // trigger a closure action to indicate that the caret "left" the top of
    // the editor canvas when pressing UP with the caret at the beginning of
    // the doc
    str: 'UP',
    run(editor, koenig) {
        let {isCollapsed, head: {offset, section}} = editor.range;
        let prevSection = section.isListItem && !section.prev ? section.parent.prev : section.prev;

        if (isCollapsed && (offset === 0 || section.isCardSection) && !prevSection) {
            koenig.send('exitCursorAtTop');
        }

        return false;
    }
}, {
    str: 'LEFT',
    run(editor, koenig) {
        let {isCollapsed, head: {offset, section}} = editor.range;

        // trigger a closure action to indicate that the caret "left" the top of
        // the editor canvas if the caret is at the very beginning of the doc
        let prevSection = section.isListItem && !section.prev ? section.parent.prev : section.prev;
        if (isCollapsed && (offset === 0 || section.isCardSection) && !prevSection) {
            koenig.send('exitCursorAtTop');
            return;
        }

        // if we have a selected card move the caret to end of the previous
        // section because the cursor will likely be at the end of the card
        // section meaning the default behaviour would move the cursor to the
        // beginning and require two key presses instead of one
        if (koenig.selectedCard && koenig.selectedCard.postModel === section) {
            koenig.moveCaretToTailOfSection(section.prev, false);
            return;
        }

        return false;
    }
}, {
    str: 'CTRL+K',
    run(editor, koenig) {
        if (Browser.isWin()) {
            return koenig.send('editLink', editor.range);
        }

        // default behaviour for Mac is delete to end of section
        return false;
    }
}, {
    str: 'META+K',
    run(editor, koenig) {
        return koenig.send('editLink', editor.range);
    }
}];

export default function registerKeyCommands(editor, koenig) {
    DEFAULT_KEY_COMMANDS.forEach((keyCommand) => {
        editor.registerKeyCommand({
            str: keyCommand.str,
            run() {
                return keyCommand.run(editor, koenig);
            }
        });
    });
}
