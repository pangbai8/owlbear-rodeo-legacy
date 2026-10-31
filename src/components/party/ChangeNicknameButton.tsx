import { useState, useEffect, ChangeEvent, FormEvent } from "react";
import { IconButton } from "theme-ui";

import ChangeNicknameModal from "../../modals/ChangeNicknameModal";
import ChangeNicknameIcon from "../../icons/ChangeNicknameIcon";

type ChangeNicknameButtonProps = {
  nickname: string;
  onChange: (nickname: string) => void;
  /** Small icon to sit beside the name in the party list */
  compact?: boolean;
};

function ChangeNicknameButton({
  nickname,
  onChange,
  compact,
}: ChangeNicknameButtonProps) {
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  function openModal() {
    setIsChangeModalOpen(true);
  }
  function closeModal() {
    setIsChangeModalOpen(false);
  }

  const [changedNickname, setChangedNickname] = useState("");

  useEffect(() => {
    setChangedNickname(nickname);
  }, [nickname]);

  function handleChangeSubmit(event: FormEvent) {
    event.preventDefault();
    onChange(changedNickname);
    closeModal();
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setChangedNickname(event.target?.value);
  }
  return (
    <>
      <IconButton
        m={compact ? 0 : 1}
        aria-label={compact ? "Edit Nickname" : "Change Nickname"}
        title="Change Nickname"
        onClick={openModal}
        sx={
          compact
            ? {
                width: "20px",
                height: "20px",
                p: 0,
                // Level with the first line of the name, which may wrap
                mt: "4px",
                flexShrink: 0,
                svg: { width: "14px", height: "14px" },
              }
            : undefined
        }
      >
        <ChangeNicknameIcon />
      </IconButton>
      <ChangeNicknameModal
        isOpen={isChangeModalOpen}
        onRequestClose={closeModal}
        onChangeSubmit={handleChangeSubmit}
        onChange={handleChange}
        nickname={changedNickname}
      />
    </>
  );
}

export default ChangeNicknameButton;
